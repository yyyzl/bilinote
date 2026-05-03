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

    // 不可重试的错误关键词
    let non_retryable = [
        "invalid",      // 参数无效
        "unauthorized", // 未授权
        "forbidden",    // 禁止访问
        "not found",    // 资源不存在
        "401",
        "403",
        "404",     // HTTP 状态码
        "api key", // API Key 问题
        "quota",   // 配额问题
    ];

    // 可重试的错误关键词
    let retryable = [
        "timeout",    // 超时
        "timed out",  // 超时
        "connection", // 连接问题
        "network",    // 网络问题
        "temporary",  // 临时错误
        "rate limit", // 限流（等待后可重试）
        "429",        // Too Many Requests
        "500",
        "502",
        "503",
        "504", // 服务端错误
    ];

    // 如果包含不可重试关键词，返回 false
    if non_retryable.iter().any(|k| msg_lower.contains(k)) {
        return false;
    }

    // 如果包含可重试关键词，返回 true
    retryable.iter().any(|k| msg_lower.contains(k))
}

pub type Result<T> = std::result::Result<T, AppError>;
