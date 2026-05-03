use crate::error::{AppError, Result};
use crate::retry::{retry_async, RetryConfig, RetryContext};
use regex::Regex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::time::Duration;

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const REFERER: &str = "https://www.bilibili.com";

// 超时配置
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const AUDIO_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300); // 音频下载超时 5 分钟
const SUBTITLE_TIMEOUT: Duration = Duration::from_secs(15); // 字幕获取 & SESSDATA 验证超时
/// 字幕质量检查：每分钟视频至少应有的字数（中文约 200-300 字/分钟，取低阈值）
const MIN_CHARS_PER_MINUTE: u64 = 50;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VideoInfo {
    pub bvid: String,
    pub aid: u64,
    pub cid: u64,
    pub title: String,
    pub cover: String,
    pub duration: u64,
}

/// 分P信息
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PageInfo {
    pub cid: u64,
    pub page: u32,
    pub part: String,
    pub duration: u64,
}

/// SESSDATA 验证结果
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LoginStatus {
    pub is_login: bool,
    pub uname: Option<String>,
}

pub struct BilibiliClient {
    client: Client,
    audio_client: Client,    // 专门用于音频下载的客户端（更长超时）
    subtitle_client: Client, // 字幕获取客户端（短超时）
}

impl BilibiliClient {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(REQUEST_TIMEOUT)
                .build()
                .unwrap(),
            audio_client: Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(AUDIO_DOWNLOAD_TIMEOUT)
                .build()
                .unwrap(),
            subtitle_client: Client::builder()
                .user_agent(USER_AGENT)
                .connect_timeout(CONNECT_TIMEOUT)
                .timeout(SUBTITLE_TIMEOUT)
                .build()
                .unwrap(),
        }
    }

    pub async fn extract_bvid(&self, input: &str) -> Result<String> {
        // 从输入中提取 HTTP/HTTPS 链接（B站复制时会带标题前缀）
        let mut url =
            if let Some(http_pos) = input.find("http://").or_else(|| input.find("https://")) {
                input[http_pos..]
                    .split_whitespace()
                    .next()
                    .unwrap_or(input)
                    .to_string()
            } else {
                input.to_string()
            };

        if url.contains("b23.tv") {
            let resp = self
                .client
                .head(&url)
                .send()
                .await
                .map_err(|e| AppError::NetworkError(e.to_string()))?;
            url = resp.url().to_string();
        }

        let re = Regex::new(r"/video/([^/?]+)").unwrap();
        if let Some(caps) = re.captures(&url) {
            url = caps[1].to_string();
        }

        if url.to_lowercase().starts_with("av") {
            let aid = &url[2..];
            return self.av_to_bv(aid).await;
        }

        if url.to_uppercase().starts_with("BV") {
            return Ok(url);
        }

        Err(AppError::InvalidLink)
    }

    async fn av_to_bv(&self, aid: &str) -> Result<String> {
        let url = format!("https://api.bilibili.com/x/web-interface/view?aid={}", aid);
        let resp: BiliResponse<VideoData> = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
            .json()
            .await
            .map_err(|e| AppError::BilibiliApi(e.to_string()))?;

        if resp.code != 0 {
            return Err(AppError::BilibiliApi(resp.message.unwrap_or_default()));
        }

        Ok(resp.data.unwrap().bvid)
    }

    pub async fn get_video_info(&self, bvid: &str) -> Result<VideoInfo> {
        let url = format!(
            "https://api.bilibili.com/x/web-interface/view?bvid={}",
            bvid
        );
        let resp: BiliResponse<VideoData> = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
            .json()
            .await
            .map_err(|e| AppError::BilibiliApi(e.to_string()))?;

        if resp.code != 0 {
            return Err(AppError::BilibiliApi(resp.message.unwrap_or_default()));
        }

        let data = resp.data.unwrap();
        Ok(VideoInfo {
            bvid: data.bvid,
            aid: data.aid,
            cid: data.cid,
            title: data.title,
            cover: data.pic,
            duration: data.duration,
        })
    }

    pub async fn download_audio(&self, aid: u64, cid: u64) -> Result<Vec<u8>> {
        let play_url = format!(
            "https://api.bilibili.com/x/player/playurl?avid={}&cid={}&fnval=16",
            aid, cid
        );
        let resp: BiliResponse<PlayData> = self
            .client
            .get(&play_url)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
            .json()
            .await
            .map_err(|e| AppError::BilibiliApi(e.to_string()))?;

        if resp.code != 0 {
            return Err(AppError::BilibiliApi("获取音频地址失败".into()));
        }

        let audio_url = &resp.data.unwrap().dash.audio[0].base_url;

        let audio_data = self
            .audio_client
            .get(audio_url)
            .header("Referer", REFERER)
            .send()
            .await
            .map_err(|e| AppError::AudioDownload(e.to_string()))?
            .bytes()
            .await
            .map_err(|e| AppError::AudioDownload(e.to_string()))?;

        Ok(audio_data.to_vec())
    }

    /// 带重试的获取视频信息
    pub async fn get_video_info_with_retry(
        &self,
        bvid: &str,
        on_retry: Option<impl Fn(RetryContext)>,
    ) -> Result<VideoInfo> {
        let config = RetryConfig::default();
        let bvid = bvid.to_string();

        retry_async(
            config,
            || {
                let bvid = bvid.clone();
                async move { self.get_video_info(&bvid).await }
            },
            on_retry,
        )
        .await
    }

    /// 带重试的下载音频
    pub async fn download_audio_with_retry(
        &self,
        aid: u64,
        cid: u64,
        on_retry: Option<impl Fn(RetryContext)>,
    ) -> Result<Vec<u8>> {
        let config = RetryConfig::default();

        retry_async(
            config,
            || async move { self.download_audio(aid, cid).await },
            on_retry,
        )
        .await
    }

    /// 获取分P列表
    pub async fn get_page_list(&self, bvid: &str) -> Result<Vec<PageInfo>> {
        let url = format!("https://api.bilibili.com/x/player/pagelist?bvid={}", bvid);
        let resp: BiliResponse<Vec<PageListItem>> = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
            .json()
            .await
            .map_err(|e| AppError::BilibiliApi(e.to_string()))?;

        if resp.code != 0 {
            return Err(AppError::BilibiliApi(
                resp.message.unwrap_or("获取分P列表失败".into()),
            ));
        }

        let pages = resp.data.unwrap_or_default();
        Ok(pages
            .into_iter()
            .map(|p| PageInfo {
                cid: p.cid,
                page: p.page,
                part: p.part,
                duration: p.duration,
            })
            .collect())
    }

    /// 验证 SESSDATA 登录态
    ///
    /// 调用 /x/web-interface/nav 判断是否登录
    pub async fn check_login_status(&self, sessdata: &str) -> Result<LoginStatus> {
        let url = "https://api.bilibili.com/x/web-interface/nav";
        let sessdata = normalize_cookie_value(sessdata);
        let resp: BiliResponse<NavData> = self
            .subtitle_client
            .get(url)
            .header("Cookie", format!("SESSDATA={}", sessdata))
            .send()
            .await
            .map_err(|e| AppError::NetworkError(e.to_string()))?
            .json()
            .await
            .map_err(|e| AppError::BilibiliApi(e.to_string()))?;

        if resp.code == -101 {
            // 未登录/过期
            return Ok(LoginStatus {
                is_login: false,
                uname: None,
            });
        }

        if resp.code != 0 {
            return Err(AppError::BilibiliApi(
                resp.message.unwrap_or("验证登录态失败".into()),
            ));
        }

        let data = resp.data.unwrap();
        Ok(LoginStatus {
            is_login: data.is_login,
            uname: if data.is_login {
                Some(data.uname)
            } else {
                None
            },
        })
    }

    /// 获取指定分P的字幕列表（参考 yt-dlp 使用 wbi/v2 端点）
    ///
    /// 返回字幕 URL 列表，失败返回 SubtitleError
    pub async fn get_subtitles(
        &self,
        bvid: &str,
        aid: u64,
        cid: u64,
        sessdata: &str,
    ) -> Result<Vec<SubtitleItem>> {
        // 参考 yt-dlp：使用 /x/player/wbi/v2 端点，同时传 aid 和 cid
        let url = format!(
            "https://api.bilibili.com/x/player/wbi/v2?aid={}&cid={}&bvid={}",
            aid, cid, bvid
        );
        let sessdata = normalize_cookie_value(sessdata);
        let response = self
            .subtitle_client
            .get(&url)
            .header("Cookie", format!("SESSDATA={}", sessdata))
            .header("Referer", REFERER)
            .header("Origin", REFERER)
            .header("Accept", "application/json,text/plain,*/*")
            .send()
            .await
            .map_err(|e| AppError::SubtitleError(format!("请求字幕接口失败: {}", e)))?;

        let status = response.status();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_string();

        let response_text = response
            .text()
            .await
            .map_err(|e| AppError::SubtitleError(format!("读取字幕响应失败: {}", e)))?;
        let response_text = response_text.trim_start_matches('\u{feff}');

        let resp: BiliResponse<PlayerV2Data> =
            serde_json::from_str(response_text).map_err(|e| {
                let body_trimmed = response_text.trim_start();
                let extra_hint = if body_trimmed.starts_with('<') {
                    "，响应看起来像 HTML 页面，可能是 Cookie 不合法或被风控拦截"
                } else if !content_type.contains("json") {
                    "，响应不是 JSON"
                } else {
                    ""
                };
                AppError::SubtitleError(format!(
                    "解析字幕响应失败: {}（HTTP {}，Content-Type: {}{}）",
                    e, status, content_type, extra_hint
                ))
            })?;

        if resp.code != 0 {
            return Err(AppError::SubtitleError(
                resp.message.unwrap_or("获取字幕失败".into()),
            ));
        }

        let data = resp.data.unwrap();

        // 参考 yt-dlp：检查 need_login_subtitle 字段
        if data.subtitle.subtitles.is_empty() && data.need_login_subtitle.unwrap_or(false) {
            return Err(AppError::SubtitleError(
                "该视频字幕需要登录才能获取，请检查 SESSDATA 是否有效".into(),
            ));
        }

        if data.subtitle.subtitles.is_empty() {
            return Err(AppError::SubtitleError("该视频无字幕".into()));
        }

        Ok(data.subtitle.subtitles)
    }

    /// 下载字幕 JSON 并提取纯文本
    ///
    /// 字幕 JSON 格式: { "body": [{ "from": 0.0, "to": 3.5, "content": "文本" }] }
    /// 参考 bilibili-youtube-watcher skill：每条字幕一行 + 去重 + 去 HTML 标签
    pub async fn download_subtitle_text(
        &self,
        subtitle_url: &str,
        sessdata: Option<&str>,
    ) -> Result<String> {
        // 字幕 URL 可能以 // 开头，需要补全 https:
        let full_url = if subtitle_url.starts_with("//") {
            format!("https:{}", subtitle_url)
        } else {
            subtitle_url.to_string()
        };

        let mut request = self
            .subtitle_client
            .get(&full_url)
            .header("Referer", REFERER)
            .header("Origin", REFERER)
            .header("Accept", "application/json,text/plain,*/*");

        if let Some(sd) = sessdata {
            let sd = normalize_cookie_value(sd);
            request = request.header("Cookie", format!("SESSDATA={}", sd));
        }

        let response = request
            .send()
            .await
            .map_err(|e| AppError::SubtitleError(format!("下载字幕失败: {}", e)))?;

        let status = response.status();
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown")
            .to_string();

        let response_text = response
            .text()
            .await
            .map_err(|e| AppError::SubtitleError(format!("读取字幕响应失败: {}", e)))?;
        let response_text = response_text.trim_start_matches('\u{feff}');

        let resp: SubtitleJson = serde_json::from_str(response_text).map_err(|e| {
            let body_trimmed = response_text.trim_start();
            let extra_hint = if body_trimmed.starts_with('<') {
                "，响应看起来像 HTML 页面，可能被 B站防盗链或登录校验拦截"
            } else if !content_type.contains("json") {
                "，响应不是 JSON"
            } else {
                ""
            };
            AppError::SubtitleError(format!(
                "解析字幕JSON失败: {}（HTTP {}，Content-Type: {}{}）",
                e, status, content_type, extra_hint
            ))
        })?;

        // 参考 bilibili-youtube-watcher skill 的处理方式：
        // 1. 去 HTML 标签  2. 去重（连续相同行）  3. 每条字幕一行
        let html_tag_re = Regex::new(r"<[^>]+>").unwrap();
        let mut text_lines: Vec<String> = Vec::new();

        for item in resp.body {
            let cleaned = html_tag_re
                .replace_all(&item.content, "")
                .trim()
                .to_string();
            if cleaned.is_empty() {
                continue;
            }
            // 去重：跳过与上一行相同的内容
            if text_lines.last().map_or(false, |last| last == &cleaned) {
                continue;
            }
            text_lines.push(cleaned);
        }

        Ok(text_lines.join("\n"))
    }

    /// 获取指定分P的字幕文本（选择最优字幕并下载）
    ///
    /// 字幕选择优先级（CC字幕优先于AI自动字幕）：
    /// 1. zh-CN / zh-Hans — UP主上传的中文CC字幕（最完整）
    /// 2. zh — 通用中文标识
    /// 3. ai-zh — B站AI自动生成（可能不完整）
    /// 4. 其他任何字幕
    pub async fn get_subtitle_text(
        &self,
        bvid: &str,
        aid: u64,
        cid: u64,
        sessdata: &str,
    ) -> Result<String> {
        let subtitles = self.get_subtitles(bvid, aid, cid, sessdata).await?;

        // 按优先级选择字幕：CC字幕 > AI字幕 > 其他
        let best = Self::select_best_subtitle(&subtitles)
            .ok_or_else(|| AppError::SubtitleError("无可用字幕".into()))?;

        eprintln!(
            "[字幕] 可用: [{}]，选择: {} ({})",
            subtitles
                .iter()
                .map(|s| format!("{}({})", s.lan, s.lan_doc))
                .collect::<Vec<_>>()
                .join(", "),
            best.lan,
            best.lan_doc
        );

        self.download_subtitle_text(&best.subtitle_url, Some(sessdata))
            .await
    }

    /// 按优先级选择最佳字幕
    ///
    /// CC字幕（人工上传）优先于AI自动生成字幕
    fn select_best_subtitle(subtitles: &[SubtitleItem]) -> Option<&SubtitleItem> {
        // 优先级 1: CC字幕（zh-CN, zh-Hans 等非 ai- 前缀的中文字幕）
        if let Some(s) = subtitles
            .iter()
            .find(|s| s.lan.contains("zh") && !s.lan.starts_with("ai-"))
        {
            return Some(s);
        }
        // 优先级 2: AI 中文字幕（ai-zh）
        if let Some(s) = subtitles.iter().find(|s| s.lan.contains("zh")) {
            return Some(s);
        }
        // 优先级 3: 任何非 AI 字幕
        if let Some(s) = subtitles.iter().find(|s| !s.lan.starts_with("ai-")) {
            return Some(s);
        }
        // 优先级 4: 任何字幕
        subtitles.first()
    }

    /// 检查字幕质量：文本长度是否与视频时长匹配
    ///
    /// 返回 true 表示字幕质量合格
    pub fn is_subtitle_sufficient(text: &str, duration_secs: u64) -> bool {
        if duration_secs == 0 {
            return !text.is_empty();
        }
        let duration_minutes = (duration_secs as f64 / 60.0).max(1.0);
        let min_chars = (duration_minutes * MIN_CHARS_PER_MINUTE as f64) as usize;
        let char_count = text.chars().count();
        char_count >= min_chars
    }
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

#[derive(Deserialize)]
struct BiliResponse<T> {
    code: i32,
    message: Option<String>,
    data: Option<T>,
}

#[derive(Deserialize)]
struct VideoData {
    bvid: String,
    aid: u64,
    cid: u64,
    title: String,
    pic: String,
    duration: u64,
}

#[derive(Deserialize)]
struct PlayData {
    dash: DashData,
}

#[derive(Deserialize)]
struct DashData {
    audio: Vec<AudioStream>,
}

#[derive(Deserialize)]
struct AudioStream {
    #[serde(rename = "baseUrl")]
    base_url: String,
}

// === 分P列表 API 响应结构 ===

#[derive(Deserialize)]
struct PageListItem {
    cid: u64,
    page: u32,
    part: String,
    duration: u64,
}

// === Nav API 响应结构（验证登录态）===

#[derive(Deserialize)]
struct NavData {
    #[serde(rename = "isLogin")]
    is_login: bool,
    uname: String,
}

// === Player V2 API 响应结构（获取字幕）===

#[derive(Deserialize)]
struct PlayerV2Data {
    subtitle: SubtitleData,
    /// 参考 yt-dlp：是否需要登录才能获取字幕
    need_login_subtitle: Option<bool>,
}

#[derive(Deserialize)]
struct SubtitleData {
    subtitles: Vec<SubtitleItem>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SubtitleItem {
    /// 语言代码，如 "zh-CN", "ai-zh", "en"
    pub lan: String,
    /// 语言描述，如 "中文（自动生成）"
    pub lan_doc: String,
    /// 字幕文件 URL
    pub subtitle_url: String,
}

// === 字幕 JSON 文件结构 ===

#[derive(Deserialize)]
struct SubtitleJson {
    body: Vec<SubtitleBodyItem>,
}

#[derive(Deserialize)]
struct SubtitleBodyItem {
    content: String,
}
