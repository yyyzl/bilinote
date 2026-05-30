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

    // 1) 限流信号最优先判为可重试：即使文案里同时出现 "quota"
    //    （"rate quota / 配额限流" 也是临时限流），也应退避重试而非直接失败。
    //    这修正了旧逻辑里限流响应体含 "quota" 被当成永久错误的问题——
    //    并发放大后该误判会让大量本应重试的任务直接失败。
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

    // 2) 明确的永久性错误关键词：认证 / 资源不存在 / 余额耗尽 / 参数非法，不重试
    let non_retryable = [
        "invalid",      // 参数无效
        "unauthorized", // 未授权
        "forbidden",    // 禁止访问
        "not found",    // 资源不存在
        "401",
        "403",
        "404",          // HTTP 状态码
        "api key",      // API Key 问题
        "insufficient", // 余额 / 配额耗尽
        "balance",      // 余额不足
        "欠费",
        "余额不足",
        "quota", // 真实配额耗尽（已排除上面的限流场景）
    ];
    if non_retryable.iter().any(|k| msg_lower.contains(k)) {
        return false;
    }

    // 3) 其它临时性错误（网络 / 5xx / 超时）可重试
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
