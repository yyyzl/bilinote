# Directory Structure

> How backend code is organized in this project.

---

## Overview

The backend is a **Rust** application built with **Tauri v2**. It serves as the bridge between the React frontend and external APIs (Bilibili, ASR, LLM). All Rust source code lives in `binote/src-tauri/src/`.

---

## Directory Layout

```
binote/src-tauri/
├── Cargo.toml              # Dependencies and build config
├── tauri.conf.json         # Tauri app configuration
├── build.rs                # Tauri build script
├── icons/                  # App icons (all platforms)
├── gen/                    # Auto-generated Tauri bindings
└── src/
    ├── main.rs             # Entry point (minimal, calls lib::run)
    ├── lib.rs              # App initialization, module declarations, Tauri setup
    ├── commands.rs         # Tauri command handlers (main business logic)
    ├── error.rs            # Unified AppError enum + Retryable trait
    ├── retry.rs            # Generic retry mechanism (exponential backoff)
    ├── store.rs            # JSON file persistence (config, notes)
    ├── bilibili.rs         # Bilibili API client (video info, audio download)
    ├── llm.rs              # OpenAI-compatible LLM client (summarize, mindmap)
    ├── notification.rs     # System notification management
    └── asr/                # ASR (speech-to-text) module
        ├── mod.rs          # AsrProvider enum, AsrClient adapter
        ├── dashscope.rs    # Aliyun DashScope ASR (qwen3-asr-flash)
        ├── sensevoice.rs   # SenseVoice ASR (SiliconFlow)
        └── utils.rs        # Shared ASR utilities
```

---

## Module Organization

### Module Declaration Pattern

All modules are declared in `lib.rs` using `pub mod`:

```rust
// lib.rs
pub mod bilibili;
pub mod asr;
pub mod llm;
pub mod store;
pub mod commands;
pub mod error;
pub mod notification;
pub mod retry;
```

Sub-modules use `mod.rs` pattern with re-exports:

```rust
// asr/mod.rs
pub mod dashscope;
pub mod sensevoice;
pub mod utils;

pub use dashscope::DashScopeClient;
pub use sensevoice::SenseVoiceClient;
```

### Where Things Go

| Concern | File | Notes |
|---------|------|-------|
| Tauri command handlers | `commands.rs` | All `#[tauri::command]` functions |
| Error types | `error.rs` | Single `AppError` enum for the entire app |
| Data persistence | `store.rs` | JSON file read/write operations |
| External API clients | `bilibili.rs`, `asr/*.rs`, `llm.rs` | One file per API provider |
| Cross-cutting concerns | `retry.rs`, `notification.rs` | Reusable utilities |
| App initialization | `lib.rs` | Tauri builder, plugin setup, state init |

### Adding New Features

When adding a **new API provider** (e.g., a new ASR service):
1. Create a new file in the appropriate module directory (e.g., `asr/new_provider.rs`)
2. Declare it in `mod.rs`: `pub mod new_provider;`
3. Add the variant to the adapter enum (e.g., `AsrClient`)
4. Register any new Tauri commands in `lib.rs` invoke handler

When adding a **new Tauri command**:
1. Define the function in `commands.rs` with `#[tauri::command]`
2. Register it in `lib.rs` `generate_handler![]` macro

---

## Naming Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| Files | `snake_case.rs` | `bilibili.rs`, `notification.rs` |
| Modules | `snake_case` | `asr`, `commands` |
| Functions | `snake_case` | `get_video_info`, `download_audio` |
| Types/Structs | `PascalCase` | `AppState`, `VideoInfo`, `DashScopeClient` |
| Enums | `PascalCase` | `AsrProvider`, `AppError`, `NotificationType` |
| Constants | `UPPER_SNAKE_CASE` | `USER_AGENT`, `CONFIG_FILE`, `ASR_ENDPOINT` |
| Method prefixes | `new`, `get_`, `load_`, `save_` | `Store::new()`, `load_config()`, `save_note()` |

---

## Examples

- **Well-organized module**: `asr/` — sub-module with adapter pattern, each provider in its own file
- **API client pattern**: `bilibili.rs` — struct with reqwest::Client, const timeouts, async methods
- **Command handler**: `commands.rs` — Tauri commands with State injection and AppHandle for events
