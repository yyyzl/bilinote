use crate::retry::Retryable;
use serde::Serialize;
use thiserror::Error;

#[derive(Error, Debug, Serialize, Clone)]
pub enum AppError {
    #[error("无法解析视频链接")]
    InvalidLink,
    #[error("获取视频信息失败: {0}")]
    BilibiliApi(String),
    #[error("音频下载失败: {0}")]
    AudioDownload(String),
    #[error("ASR 转录失败: {0}")]
    AsrError(String),
    #[error("LLM 调用失败: {0}")]
    LlmError(String),
    #[error("字幕获取失败: {0}")]
    SubtitleError(String),
    #[error("存储错误: {0}")]
    StoreError(String),
    #[error("网络请求失败: {0}")]
    NetworkError(String),
    #[error("认证失败: {0}")]
    AuthError(String),
}

impl Retryable for AppError {
    fn is_retryable(&self) -> bool {
        match self {
            // 网络错误通常可重试
            AppError::NetworkError(_) => true,
            // 音频下载失败可重试
            AppError::AudioDownload(_) => true,
            // API 错误需要根据具体情况判断
            AppError::BilibiliApi(msg) => is_retryable_api_error(msg),
            AppError::AsrError(msg) => is_retryable_api_error(msg),
            AppError::LlmError(msg) => is_retryable_api_error(msg),
            // 字幕错误不重试（直接 fallback ASR）
            AppError::SubtitleError(_) => false,
            // 以下错误不应重试
            AppError::InvalidLink => false,
            AppError::StoreError(_) => false,
            AppError::AuthError(_) => false,
        }
    }
}

/// 判断 API 错误是否可重试
fn is_retryable_api_error(msg: &str) -> bool {
    let msg_lower = msg.to_lowercase();

    // 1) 「额度/账单」类硬永久错误最优先判为不可重试：即便响应携带 HTTP 429，
    //    也绝不能重试。OpenAI 兼容 LLM 的真实配额耗尽 (insufficient_quota) 正是
    //    以 HTTP 429 返回（错误体形如 "HTTP 429 Too Many Requests - {...insufficient_quota...}"），
    //    若先判 429 可重试，配额耗尽会被无谓退避重试到上限才失败、并在并发下放大浪费。
    //    这里用更具体的短语（insufficient_quota / 余额不足 …）而非裸 "quota"/"insufficient"/"balance"，
    //    既能拦住真实额度耗尽，又不误伤 "rate quota / 限流" 等临时场景。
    let hard_permanent = [
        "insufficient_quota", // OpenAI 配额耗尽（常以 HTTP 429 返回）
        "insufficient quota",
        "insufficient_user_quota",
        "insufficient balance", // 余额不足（含空格变体）
        "insufficient_balance",
        "exceeded your current quota", // OpenAI 配额耗尽典型文案
        "欠费",
        "余额不足",
    ];
    if hard_permanent.iter().any(|k| msg_lower.contains(k)) {
        return false;
    }

    // 2) 限流信号判为可重试：即使文案里出现 "quota"（"rate quota / 配额限流"
    //    属临时限流），也应退避重试而非直接失败——上一步已先排除真实额度耗尽。
    let rate_limited = [
        "rate limit",        // 限流
        "ratelimit",         // 限流（无空格变体）
        "too many requests", // 429 文案
        "requests per",      // "N requests per minute" 文案
        "429",               // Too Many Requests
    ];
    if rate_limited.iter().any(|k| msg_lower.contains(k)) {
        return true;
    }

    // 3) 其它明确的永久性错误关键词：认证 / 资源不存在 / 参数非法，不重试
    let non_retryable = [
        "invalid",      // 参数无效
        "unauthorized", // 未授权
        "forbidden",    // 禁止访问
        "not found",    // 资源不存在
        "401",
        "403",
        "404",     // HTTP 状态码
        "api key", // API Key 问题
    ];
    if non_retryable.iter().any(|k| msg_lower.contains(k)) {
        return false;
    }

    // 4) 其它临时性错误（网络 / 5xx / 超时）可重试
    let retryable = [
        "timeout",    // 超时
        "timed out",  // 超时
        "connection", // 连接问题
        "network",    // 网络问题
        "temporary",  // 临时错误
        "500",
        "502",
        "503",
        "504", // 服务端错误
    ];
    retryable.iter().any(|k| msg_lower.contains(k))
}

pub type Result<T> = std::result::Result<T, AppError>;
