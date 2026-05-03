# Error Handling

> How errors are handled in this project.

---

## Overview

This project uses a **unified error enum** (`AppError`) with the `thiserror` crate. All errors across the application are channeled through this single type, making error handling consistent and predictable.

Key design decisions:
- **Single error type** — one `AppError` enum for the entire backend
- **Serializable errors** — `Serialize + Clone` so errors can be sent to the frontend via Tauri
- **Retryable classification** — errors implement `Retryable` trait for automatic retry logic
- **Chinese error messages** — user-facing error messages are in Chinese

---

## Error Types

### AppError Enum (`error.rs`)

```rust
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

    #[error("存储错误: {0}")]
    StoreError(String),

    #[error("网络请求失败: {0}")]
    NetworkError(String),
}
```

### Type Alias

```rust
pub type Result<T> = std::result::Result<T, AppError>;
```

All functions in the codebase use `Result<T>` (which resolves to `std::result::Result<T, AppError>`).

---

## Error Handling Patterns

### 1. Error Propagation with `?` Operator

Errors are propagated using the `?` operator, with `.map_err()` to convert external errors into `AppError`:

```rust
// ✅ Correct pattern: map_err to convert reqwest::Error → AppError
let resp = self.client
    .get(&url)
    .send()
    .await
    .map_err(|e| AppError::NetworkError(e.to_string()))?;

let data: VideoData = resp
    .json()
    .await
    .map_err(|e| AppError::BilibiliApi(e.to_string()))?;
```

### 2. Retryable Error Classification

Errors implement the `Retryable` trait to determine if an operation should be retried:

```rust
impl Retryable for AppError {
    fn is_retryable(&self) -> bool {
        match self {
            AppError::NetworkError(_) => true,      // Always retryable
            AppError::AudioDownload(_) => true,      // Always retryable
            AppError::BilibiliApi(msg) => is_retryable_api_error(msg),
            AppError::AsrError(msg) => is_retryable_api_error(msg),
            AppError::LlmError(msg) => is_retryable_api_error(msg),
            AppError::InvalidLink => false,          // Never retryable
            AppError::StoreError(_) => false,        // Never retryable
        }
    }
}
```

**Retryable keywords**: `timeout`, `connection`, `rate limit`, `429`, `500`, `502`, `503`, `504`
**Non-retryable keywords**: `invalid`, `unauthorized`, `forbidden`, `not found`, `401`, `403`, `404`, `api key`, `quota`

### 3. Graceful Degradation in Pipelines

The transcription pipeline uses partial success enums:

```rust
enum TranscribeResult {
    FullSuccess(Note),
    TranscribeOnly {
        note: Note,
        summarize_error: Option<String>,
        mindmap_error: Option<String>,
    },
}
```

This means: if transcription succeeds but LLM summarization fails, the note is still saved.

### 4. Generic Retry Mechanism

```rust
// retry.rs — exponential backoff with jitter
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
```

Default retry config: 3 retries, 500ms initial delay, 2.0 backoff factor, 10s max delay, random jitter.

---

## API Error Responses

Errors are automatically serialized to JSON by Tauri's command system. The frontend receives them as rejected Promise values.

**Backend → Frontend flow**:
1. Rust function returns `Err(AppError::SomeVariant("details"))`
2. Tauri serializes via `Serialize` trait → JSON string
3. Frontend catches via `try/catch` on `invoke()` calls
4. `formatError()` utility normalizes display

---

## Common Mistakes

### ❌ Don't: Swallow errors silently

```rust
// BAD: error is silently ignored
let _ = do_something();
```

### ✅ Do: Log or propagate

```rust
// GOOD: propagate with ?
do_something()?;

// GOOD: explicit ignore with comment if truly intentional
let _ = app.emit("event", payload); // Emit failure is non-critical
```

### ❌ Don't: Use `unwrap()` on user-facing operations

```rust
// BAD: panics on failure
let config = serde_json::from_str(&content).unwrap();
```

### ✅ Do: Map to AppError

```rust
// GOOD: graceful error
let config = serde_json::from_str(&content)
    .map_err(|e| AppError::StoreError(e.to_string()))?;
```

**Exception**: `unwrap()` is acceptable for `Client::builder().build().unwrap()` during app initialization, where failure means misconfiguration.

### ❌ Don't: Create new error types outside `error.rs`

All error variants must be defined in `error.rs` to maintain a single source of truth.
