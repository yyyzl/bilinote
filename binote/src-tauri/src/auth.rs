//! B站认证模块：QR 码扫码登录 + Cookie 自动刷新
//!
//! ## QR 码登录流程
//! 1. 调用 generate_qrcode() 获取 QR 码 URL 和 qrcode_key
//! 2. 前端用 qrcode.react 渲染 QR 码
//! 3. 用户用 B 站 App 扫码确认
//! 4. 前端轮询 poll_qrcode()，成功后自动保存全部凭证
//!
//! ## Cookie 刷新流程
//! 1. 检查 Cookie 是否需要刷新（/x/passport-login/web/cookie/info）
//! 2. RSA 加密生成 correspondPath
//! 3. 获取 refresh_csrf
//! 4. 执行刷新请求
//! 5. 确认刷新（使旧 refresh_token 失效）

use crate::error::{AppError, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const AUTH_TIMEOUT: Duration = Duration::from_secs(15);

/// B 站登录凭证（从 Set-Cookie 解析）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BiliCredentials {
    pub sessdata: String,
    pub bili_jct: String,
    pub dede_user_id: String,
    pub refresh_token: String,
}

/// QR 码生成结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QrcodeInfo {
    /// QR 码内容 URL（前端渲染用）
    pub url: String,
    /// QR 码 key（轮询用）
    pub qrcode_key: String,
}

/// QR 码轮询状态
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QrcodePollResult {
    /// 状态码: "waiting" | "scanned" | "expired" | "success"
    pub status: String,
    /// 状态信息
    pub message: String,
    /// 登录成功时的凭证
    pub credentials: Option<BiliCredentials>,
}

/// Cookie 刷新结果
#[derive(Debug)]
pub enum RefreshResult {
    /// 不需要刷新
    NotNeeded,
    /// 刷新成功，返回新凭证
    Success(BiliCredentials),
    /// 刷新失败
    Failed(String),
}

pub struct BiliAuth {
    client: Client,
}

impl BiliAuth {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(AUTH_TIMEOUT)
                .build()
                .unwrap(),
        }
    }

    // ============================
    // QR 码登录
    // ============================

    /// 生成 QR 码登录信息
    pub async fn generate_qrcode(&self) -> Result<QrcodeInfo> {
        let url = "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
        let resp: QrcodeGenResp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| AppError::AuthError(format!("请求二维码接口失败: {}", e)))?
            .json()
            .await
            .map_err(|e| AppError::AuthError(format!("解析二维码响应失败: {}", e)))?;

        if resp.code != 0 {
            return Err(AppError::AuthError(
                resp.message.unwrap_or("生成二维码失败".into()),
            ));
        }

        let data = resp
            .data
            .ok_or(AppError::AuthError("二维码数据为空".into()))?;
        Ok(QrcodeInfo {
            url: data.url,
            qrcode_key: data.qrcode_key,
        })
    }

    /// 轮询 QR 码扫码状态
    ///
    /// 返回状态：
    /// - waiting: 等待扫码
    /// - scanned: 已扫码，等待确认
    /// - expired: 二维码已过期
    /// - success: 登录成功（包含凭证）
    pub async fn poll_qrcode(&self, qrcode_key: &str) -> Result<QrcodePollResult> {
        let url = format!(
            "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key={}",
            qrcode_key
        );

        // 重要：不能自动处理 cookie，需要手动读取 Set-Cookie
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::AuthError(format!("轮询二维码状态失败: {}", e)))?;

        // 先提取 Set-Cookie 头（在消费 body 之前）
        let set_cookies: Vec<String> = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok().map(String::from))
            .collect();

        let body: QrcodePollResp = resp
            .json()
            .await
            .map_err(|e| AppError::AuthError(format!("解析轮询响应失败: {}", e)))?;

        if body.code != 0 {
            return Err(AppError::AuthError(
                body.message.unwrap_or("轮询失败".into()),
            ));
        }

        let data = body
            .data
            .ok_or(AppError::AuthError("轮询数据为空".into()))?;

        match data.code {
            0 => {
                // 登录成功！解析 Set-Cookie 和 refresh_token
                let mut sessdata = None;
                let mut bili_jct = None;
                let mut dede_user_id = None;

                for cookie_str in &set_cookies {
                    if let Some(val) = extract_cookie_value(cookie_str, "SESSDATA") {
                        sessdata = Some(val);
                    }
                    if let Some(val) = extract_cookie_value(cookie_str, "bili_jct") {
                        bili_jct = Some(val);
                    }
                    if let Some(val) = extract_cookie_value(cookie_str, "DedeUserID") {
                        dede_user_id = Some(val);
                    }
                }

                let sessdata =
                    sessdata.ok_or(AppError::AuthError("登录成功但未获取到 SESSDATA".into()))?;
                let bili_jct =
                    bili_jct.ok_or(AppError::AuthError("登录成功但未获取到 bili_jct".into()))?;
                let dede_user_id = dede_user_id.unwrap_or_default();
                let refresh_token = data.refresh_token.unwrap_or_default();

                Ok(QrcodePollResult {
                    status: "success".into(),
                    message: "登录成功".into(),
                    credentials: Some(BiliCredentials {
                        sessdata,
                        bili_jct,
                        dede_user_id,
                        refresh_token,
                    }),
                })
            }
            86038 => Ok(QrcodePollResult {
                status: "expired".into(),
                message: "二维码已过期，请刷新".into(),
                credentials: None,
            }),
            86090 => Ok(QrcodePollResult {
                status: "scanned".into(),
                message: "已扫码，请在手机上确认".into(),
                credentials: None,
            }),
            86101 => Ok(QrcodePollResult {
                status: "waiting".into(),
                message: "等待扫码...".into(),
                credentials: None,
            }),
            _ => Ok(QrcodePollResult {
                status: "waiting".into(),
                message: data.message.unwrap_or("未知状态".into()),
                credentials: None,
            }),
        }
    }

    // ============================
    // Cookie 自动刷新
    // ============================

    /// 尝试刷新 Cookie
    ///
    /// 完整流程：检查 → RSA 加密 → 获取 refresh_csrf → 刷新 → 确认
    pub async fn try_refresh_cookie(
        &self,
        sessdata: &str,
        bili_jct: &str,
        refresh_token: &str,
    ) -> Result<RefreshResult> {
        // Step 1: 检查是否需要刷新
        let cookie_info = self.check_cookie_info(sessdata, bili_jct).await?;
        if !cookie_info.refresh {
            return Ok(RefreshResult::NotNeeded);
        }

        eprintln!("[auth] Cookie 需要刷新，开始刷新流程...");

        // Step 2: RSA 加密生成 correspondPath
        let correspond_path = generate_correspond_path(cookie_info.timestamp)
            .map_err(|e| AppError::AuthError(format!("RSA 加密失败: {}", e)))?;

        // Step 3: 获取 refresh_csrf
        let refresh_csrf = self
            .fetch_refresh_csrf(sessdata, &correspond_path)
            .await
            .map_err(|e| AppError::AuthError(format!("获取 refresh_csrf 失败: {}", e)))?;

        // Step 4: 执行刷新
        let new_credentials = self
            .refresh_cookie(sessdata, bili_jct, &refresh_csrf, refresh_token)
            .await?;

        // Step 5: 确认刷新（使旧 refresh_token 失效）
        if let Err(e) = self
            .confirm_refresh(
                &new_credentials.sessdata,
                &new_credentials.bili_jct,
                refresh_token,
            )
            .await
        {
            eprintln!("[auth] 确认刷新失败（不影响使用）: {}", e);
        }

        eprintln!("[auth] Cookie 刷新成功！");
        Ok(RefreshResult::Success(new_credentials))
    }

    /// 检查 Cookie 是否需要刷新
    async fn check_cookie_info(&self, sessdata: &str, bili_jct: &str) -> Result<CookieInfoData> {
        let url = "https://passport.bilibili.com/x/passport-login/web/cookie/info";
        let sessdata = normalize_cookie_value(sessdata);
        let resp: CookieInfoResp = self
            .client
            .get(url)
            .header(
                "Cookie",
                format!("SESSDATA={}; bili_jct={}", sessdata, bili_jct),
            )
            .query(&[("csrf", bili_jct)])
            .send()
            .await
            .map_err(|e| AppError::AuthError(format!("检查 Cookie 状态失败: {}", e)))?
            .json()
            .await
            .map_err(|e| AppError::AuthError(format!("解析 Cookie 状态失败: {}", e)))?;

        if resp.code != 0 {
            return Err(AppError::AuthError(format!(
                "检查 Cookie 状态返回错误: code={}",
                resp.code
            )));
        }

        resp.data
            .ok_or(AppError::AuthError("Cookie 状态数据为空".into()))
    }

    /// 获取 refresh_csrf（从 correspond 页面提取）
    async fn fetch_refresh_csrf(&self, sessdata: &str, correspond_path: &str) -> Result<String> {
        let url = format!("https://www.bilibili.com/correspond/1/{}", correspond_path);
        let sessdata = normalize_cookie_value(sessdata);
        let html = self
            .client
            .get(&url)
            .header("Cookie", format!("SESSDATA={}", sessdata))
            .send()
            .await
            .map_err(|e| AppError::AuthError(format!("请求 correspond 页面失败: {}", e)))?
            .text()
            .await
            .map_err(|e| AppError::AuthError(format!("读取 correspond 页面失败: {}", e)))?;

        // 用 regex 提取 <div id="1-name">xxx</div>
        let re = regex::Regex::new(r#"<div id="1-name">([^<]+)</div>"#).unwrap();
        let caps = re.captures(&html).ok_or(AppError::AuthError(
            "无法从 correspond 页面提取 refresh_csrf".into(),
        ))?;
        Ok(caps[1].to_string())
    }

    /// 执行 Cookie 刷新请求
    async fn refresh_cookie(
        &self,
        sessdata: &str,
        bili_jct: &str,
        refresh_csrf: &str,
        refresh_token: &str,
    ) -> Result<BiliCredentials> {
        let url = "https://passport.bilibili.com/x/passport-login/web/cookie/refresh";
        let sessdata = normalize_cookie_value(sessdata);

        let resp = self
            .client
            .post(url)
            .header(
                "Cookie",
                format!("SESSDATA={}; bili_jct={}", sessdata, bili_jct),
            )
            .form(&[
                ("csrf", bili_jct),
                ("refresh_csrf", refresh_csrf),
                ("source", "main_web"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(|e| AppError::AuthError(format!("刷新 Cookie 请求失败: {}", e)))?;

        // 先提取 Set-Cookie
        let set_cookies: Vec<String> = resp
            .headers()
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok().map(String::from))
            .collect();

        let body: RefreshCookieResp = resp
            .json()
            .await
            .map_err(|e| AppError::AuthError(format!("解析刷新响应失败: {}", e)))?;

        if body.code != 0 {
            return Err(AppError::AuthError(format!(
                "刷新 Cookie 失败: code={}, msg={}",
                body.code,
                body.message.unwrap_or_default()
            )));
        }

        let new_refresh_token = body.data.and_then(|d| d.refresh_token).unwrap_or_default();

        // 从 Set-Cookie 解析新凭证
        let mut new_sessdata = None;
        let mut new_bili_jct = None;
        let mut new_dede_user_id = None;

        for cookie_str in &set_cookies {
            if let Some(val) = extract_cookie_value(cookie_str, "SESSDATA") {
                new_sessdata = Some(val);
            }
            if let Some(val) = extract_cookie_value(cookie_str, "bili_jct") {
                new_bili_jct = Some(val);
            }
            if let Some(val) = extract_cookie_value(cookie_str, "DedeUserID") {
                new_dede_user_id = Some(val);
            }
        }

        Ok(BiliCredentials {
            sessdata: new_sessdata.unwrap_or_else(|| sessdata.to_string()),
            bili_jct: new_bili_jct.unwrap_or_else(|| bili_jct.to_string()),
            dede_user_id: new_dede_user_id.unwrap_or_default(),
            refresh_token: new_refresh_token,
        })
    }

    /// 确认刷新（使旧 refresh_token 失效）
    async fn confirm_refresh(
        &self,
        new_sessdata: &str,
        new_bili_jct: &str,
        old_refresh_token: &str,
    ) -> Result<()> {
        let url = "https://passport.bilibili.com/x/passport-login/web/confirm/refresh";
        let new_sessdata = normalize_cookie_value(new_sessdata);

        let resp: ConfirmRefreshResp = self
            .client
            .post(url)
            .header(
                "Cookie",
                format!("SESSDATA={}; bili_jct={}", new_sessdata, new_bili_jct),
            )
            .form(&[("csrf", new_bili_jct), ("refresh_token", old_refresh_token)])
            .send()
            .await
            .map_err(|e| AppError::AuthError(format!("确认刷新请求失败: {}", e)))?
            .json()
            .await
            .map_err(|e| AppError::AuthError(format!("解析确认刷新响应失败: {}", e)))?;

        if resp.code != 0 {
            return Err(AppError::AuthError(format!(
                "确认刷新失败: code={}",
                resp.code
            )));
        }

        Ok(())
    }
}

// ============================
// RSA 加密工具
// ============================

/// B 站 Cookie 刷新用的 RSA 公钥
const BILIBILI_RSA_PUBLIC_KEY: &str = "-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDLgd2OAkcGVtoE3ThUREbio0Eg
Uc/prcajMKXvkCKFCWhJYJcLkcM2DKKcSeFpD/j6Boy538YXnR6VhcuUJOhH2x71
nzPjfdTcqMz7djHKETI/PgKfSE78CIaFNyPJdIAUiPSYEM3elGMsJy0GWFZdWkKp
PdQG/yLKQzBIIwIDAQAB
-----END PUBLIC KEY-----";

/// 使用 RSA-OAEP + SHA-256 加密生成 correspondPath
fn generate_correspond_path(
    timestamp: i64,
) -> std::result::Result<String, Box<dyn std::error::Error>> {
    use rsa::{pkcs8::DecodePublicKey, sha2::Sha256, Oaep, RsaPublicKey};

    let public_key = RsaPublicKey::from_public_key_pem(BILIBILI_RSA_PUBLIC_KEY)?;
    let plaintext = format!("refresh_{}", timestamp);
    let padding = Oaep::new::<Sha256>();
    let mut rng = rand::thread_rng();
    let encrypted = public_key.encrypt(&mut rng, padding, plaintext.as_bytes())?;

    Ok(hex::encode(encrypted))
}

// ============================
// Cookie 解析工具
// ============================

/// 从 Set-Cookie 头中提取指定 cookie 的值
///
/// 格式: "SESSDATA=abc123; Path=/; Domain=.bilibili.com; ..."
fn extract_cookie_value(cookie_str: &str, name: &str) -> Option<String> {
    let prefix = format!("{}=", name);
    if !cookie_str.starts_with(&prefix) {
        return None;
    }
    let value_start = prefix.len();
    let value = &cookie_str[value_start..];
    // 取到第一个 ';' 或字符串末尾
    let value = value.split(';').next().unwrap_or(value);
    // 保持 Set-Cookie 原始编码，后续写回 Cookie 头时再做规范化
    Some(value.to_string())
}

fn normalize_cookie_value(value: &str) -> Cow<'_, str> {
    if value.contains('%') || !value.chars().any(is_cookie_unsafe_char) {
        Cow::Borrowed(value)
    } else {
        Cow::Owned(urlencoding::encode(value).into_owned())
    }
}

fn is_cookie_unsafe_char(ch: char) -> bool {
    matches!(ch, ',' | ';' | ' ' | '\t' | '\r' | '\n')
}

// ============================
// API 响应结构体
// ============================

#[derive(Deserialize)]
struct QrcodeGenResp {
    code: i32,
    message: Option<String>,
    data: Option<QrcodeGenData>,
}

#[derive(Deserialize)]
struct QrcodeGenData {
    url: String,
    qrcode_key: String,
}

#[derive(Deserialize)]
struct QrcodePollResp {
    code: i32,
    message: Option<String>,
    data: Option<QrcodePollData>,
}

#[derive(Deserialize)]
struct QrcodePollData {
    code: i32,
    message: Option<String>,
    refresh_token: Option<String>,
    #[allow(dead_code)]
    url: Option<String>,
}

#[derive(Deserialize)]
struct CookieInfoResp {
    code: i32,
    data: Option<CookieInfoData>,
}

#[derive(Deserialize)]
struct CookieInfoData {
    /// 是否需要刷新
    refresh: bool,
    /// 服务器时间戳（用于 RSA 加密）
    timestamp: i64,
}

#[derive(Deserialize)]
struct RefreshCookieResp {
    code: i32,
    message: Option<String>,
    data: Option<RefreshCookieData>,
}

#[derive(Deserialize)]
struct RefreshCookieData {
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
struct ConfirmRefreshResp {
    code: i32,
}
