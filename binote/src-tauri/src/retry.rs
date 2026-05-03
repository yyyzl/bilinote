//! 重试工具模块
//!
//! 提供带指数退避的通用重试机制

use rand::Rng;
use std::future::Future;
use std::time::Duration;
use tokio::time::sleep;

/// 重试配置
#[derive(Clone)]
pub struct RetryConfig {
    /// 最大重试次数（不包括首次尝试）
    pub max_retries: u32,
    /// 初始延迟（毫秒）
    pub initial_delay_ms: u64,
    /// 最大延迟（毫秒）
    pub max_delay_ms: u64,
    /// 退避因子
    pub backoff_factor: f64,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            max_retries: 3,
            initial_delay_ms: 500,
            max_delay_ms: 10_000,
            backoff_factor: 2.0,
        }
    }
}

/// 重试上下文，传递给回调
pub struct RetryContext {
    /// 当前尝试次数（从 1 开始）
    pub attempt: u32,
    /// 最大尝试次数（首次 + 重试次数）
    pub max_attempts: u32,
    /// 上一次的错误信息（首次尝试为 None）
    pub last_error: Option<String>,
}

/// 判断错误是否可重试的 trait
pub trait Retryable {
    fn is_retryable(&self) -> bool;
}

/// 带重试的异步执行器
///
/// # 参数
/// - `config`: 重试配置
/// - `operation`: 要执行的异步操作
/// - `on_retry`: 重试时的回调（可选，用于更新进度）
///
/// # 示例
/// ```ignore
/// let result = retry_async(
///     RetryConfig::default(),
///     || async { download_audio().await },
///     Some(|ctx| println!("重试 {}/{}", ctx.attempt, ctx.max_attempts)),
/// ).await;
/// ```
pub async fn retry_async<T, E, F, Fut, C>(
    config: RetryConfig,
    mut operation: F,
    on_retry: Option<C>,
) -> Result<T, E>
where
    E: Retryable + std::fmt::Display,
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    C: Fn(RetryContext),
{
    let max_attempts = config.max_retries + 1;
    let mut last_error: Option<E> = None;

    for attempt in 1..=max_attempts {
        // 如果不是首次尝试，先等待
        if attempt > 1 {
            let delay = calculate_delay(&config, attempt - 1);
            sleep(Duration::from_millis(delay)).await;

            // 调用重试回调
            if let Some(ref callback) = on_retry {
                callback(RetryContext {
                    attempt,
                    max_attempts,
                    last_error: last_error.as_ref().map(|e| e.to_string()),
                });
            }
        }

        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                // 检查错误是否可重试
                if !e.is_retryable() || attempt == max_attempts {
                    return Err(e);
                }
                last_error = Some(e);
            }
        }
    }

    // 理论上不会到达这里，但为了编译器满意
    Err(last_error.unwrap())
}

/// 计算延迟时间（带随机抖动）
fn calculate_delay(config: &RetryConfig, retry_count: u32) -> u64 {
    let base_delay =
        config.initial_delay_ms as f64 * config.backoff_factor.powi(retry_count as i32);
    let capped_delay = base_delay.min(config.max_delay_ms as f64);

    // 添加 0-100ms 的随机抖动
    let jitter = rand::thread_rng().gen_range(0..100);

    capped_delay as u64 + jitter
}
