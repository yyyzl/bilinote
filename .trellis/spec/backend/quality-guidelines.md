# Quality Guidelines

> Code quality standards for backend (Rust) development.

---

## Overview

The Rust backend follows standard Rust idioms with a focus on:
- **Safety** — no `unsafe` code, Mutex-wrapped shared state
- **Error handling** — unified `AppError` enum, no panics in user paths
- **Async correctness** — proper cancellation, no lock-across-await

---

## Forbidden Patterns

### ❌ `unwrap()` on user-facing operations

```rust
// BAD: panics on failure in production
let config: AppConfig = serde_json::from_str(&content).unwrap();
```

**Exception**: `unwrap()` is acceptable for:
- `Client::builder().build().unwrap()` — initialization-time, misconfiguration = fatal
- `Mutex::lock().unwrap()` — poisoned mutex = unrecoverable

### ❌ Holding Mutex lock across `.await`

```rust
// BAD: blocks other tasks, potential deadlock
let store = state.store.lock().unwrap();
let data = store.some_async_call().await;
```

### ❌ Locking the same `Mutex` twice inside one statement or branch

```rust
// BAD: the first guard can live until the end of the if-let statement
if let Ok(mut config) = store.lock().unwrap().load_config() {
    let _ = store.lock().unwrap().save_config(&config);
}
```

Use a helper function or an inner scope so the first guard is dropped before the second lock.

### ❌ Creating new error types outside `error.rs`

All error variants must be defined in the single `AppError` enum.

### ❌ `unsafe` code

No `unsafe` blocks anywhere in the codebase. Not needed and not allowed.

### ❌ Blocking I/O in async context

```rust
// BAD: blocks the tokio runtime thread
let content = std::fs::read_to_string(&path)?;  // This is OK for small files
// but for large files, use tokio::fs
```

**Note**: Current codebase uses `std::fs` for JSON config/notes files (small), which is acceptable.

### ❌ Silently swallowing errors

```rust
// BAD: error disappears
let _ = important_operation();
```

Only acceptable for truly non-critical operations with a comment:
```rust
let _ = app.emit("event", payload); // Non-critical: UI update only
```

---

## Required Patterns

### ✅ Use `map_err` for error conversion

```rust
let data = reqwest_response
    .json()
    .await
    .map_err(|e| AppError::BilibiliApi(e.to_string()))?;
```

### ✅ Use `#[serde(default)]` for new fields

When adding fields to persisted structs, always add `#[serde(default)]` for backward compatibility.

### ✅ Use `CancellationToken` for background tasks

```rust
let cancel_token = state.global_cancel.child_token();
tokio::select! {
    _ = cancel_token.cancelled() => { /* cleanup */ }
    result = operation() => result
}
```

### ✅ Constants for configuration values

```rust
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const USER_AGENT: &str = "Mozilla/5.0 ...";
```

### ✅ Adapter pattern for multi-provider features

```rust
pub enum AsrClient {
    DashScope(DashScopeClient),
    SenseVoice(SenseVoiceClient),
}

impl AsrClient {
    pub async fn transcribe(&self, audio: &[u8]) -> Result<String> {
        match self {
            AsrClient::DashScope(c) => c.transcribe(audio).await,
            AsrClient::SenseVoice(c) => c.transcribe(audio).await,
        }
    }
}
```

### ✅ Emit progress events for long-running operations

```rust
let _ = app.emit("transcribe:progress", "正在下载音频...");
```

### ✅ Use `tokio::join!` for parallel independent operations

```rust
let (summary_result, mindmap_result) = tokio::join!(
    llm.summarize(&transcript, &title),
    llm.generate_mindmap(&transcript, &title)
);
```

---

## Testing Requirements

**Current state**: No unit tests exist in the codebase.

**Recommended minimum**:
- Unit tests for `error.rs` — retryable classification logic
- Unit tests for `store.rs` — CRUD operations with temp files
- Unit tests for `bilibili.rs` — BVID extraction from various URL formats
- Integration tests for retry mechanism

---

## Code Review Checklist

When reviewing Rust backend changes:

- [ ] No `unwrap()` on fallible operations (except permitted cases)
- [ ] Errors use existing `AppError` variants (or add new variant in `error.rs`)
- [ ] Mutex locks are scoped minimally (no lock across `.await`)
- [ ] No nested or repeated `Mutex::lock()` on the same value in one statement/branch
- [ ] New fields on persisted structs have `#[serde(default)]`
- [ ] Long-running operations emit progress events
- [ ] Background tasks use `CancellationToken`
- [ ] Constants defined for magic numbers/URLs
- [ ] API clients use proper timeouts
- [ ] HTTP requests include appropriate headers (User-Agent, Referer for Bilibili)

---

## Dependencies & Build

### Key Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `tauri` | 2.x | App framework |
| `reqwest` | 0.12 | HTTP client (json, rustls-tls, multipart) |
| `tokio` | 1.x | Async runtime (full features) |
| `tokio-util` | 0.7 | CancellationToken |
| `serde` / `serde_json` | 1.x | Serialization |
| `thiserror` | 2.x | Error derive macros |
| `uuid` | 1.x | Note ID generation (v4) |
| `chrono` | 0.4 | Timestamps |
| `rand` | 0.8 | Retry jitter |
| `base64` | 0.22 | Audio encoding for DashScope |
| `regex` | 1.x | BVID extraction |

### Build Targets

```toml
[lib]
name = "binote_lib"
crate-type = ["staticlib", "cdylib", "rlib"]
# staticlib: Android NDK
# cdylib: Tauri desktop
# rlib: Rust lib format
```
