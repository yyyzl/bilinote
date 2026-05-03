# Logging Guidelines

> How logging is done in this project.

---

## Overview

**Current state**: This project does **not** use a structured logging framework. The only logging mechanism is `eprintln!()` for error output to stderr.

This is an area for future improvement. The guidelines below document the current practice and recommended direction.

---

## Current Practice

### Error Output

```rust
// notification.rs — the only logging in the codebase
if let Err(e) = builder.show() {
    eprintln!("Failed to show notification: {}", e);
}
```

### Progress Events (used instead of logs)

Instead of traditional logging, the app uses **Tauri event emissions** to communicate progress to the frontend:

```rust
// commands.rs — real-time progress updates
let _ = app.emit("transcribe:progress", "正在获取视频信息...");
let _ = app.emit("transcribe:progress", format!(
    "获取视频信息失败，正在重试 ({}/{})...",
    ctx.attempt, ctx.max_attempts
));
```

These events serve dual purpose:
1. **User-facing progress** — displayed in the UI
2. **Debug visibility** — developers can trace operation flow

---

## Event Types

| Event | Purpose | Payload |
|-------|---------|---------|
| `transcribe:progress` | Transcription pipeline status | Chinese string message |
| `summarize:progress` | LLM summary generation status | Chinese string message |
| `mindmap:progress` | Mindmap generation status | Chinese string message |

---

## What Should Be Logged (Future)

If a logging framework is added (recommended: `tracing` crate), these events should be logged:

### Info Level
- API request start/end (with elapsed time)
- Note creation/deletion
- Configuration changes
- Task start/completion

### Warn Level
- Retry attempts (currently only emit events)
- Non-critical failures (notification send failure)
- Deprecated API usage

### Error Level
- API failures (with request details)
- File I/O failures
- Deserialization failures
- Unexpected state transitions

### Debug Level
- Request/response bodies (truncated)
- Audio data size
- ASR provider selection
- Retry delay calculations

---

## What NOT to Log

- ❌ API keys or tokens (even partially)
- ❌ Full audio data content
- ❌ User's file system paths beyond app data dir
- ❌ Full transcript content (can be very large)

---

## Recommended Future Setup

```rust
// Cargo.toml
[dependencies]
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

// lib.rs
tracing_subscriber::fmt()
    .with_env_filter("binote=debug,reqwest=warn")
    .init();
```

```rust
// Usage pattern
use tracing::{info, warn, error, debug};

info!(bvid = %bvid, "Starting transcription");
warn!(attempt = ctx.attempt, max = ctx.max_attempts, "Retrying operation");
error!(error = %e, "Failed to download audio");
debug!(audio_size = audio_data.len(), "Audio downloaded");
```
