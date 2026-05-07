# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BiNote is a desktop application for transcribing and summarizing Bilibili videos using AI. Built with Tauri v2, Rust backend, and React frontend.

## Build Commands

```bash
# Development (hot reload)
cd binote && npm run tauri dev

# Production build
cd binote && npm run tauri build

# Frontend only
cd binote && npm run dev      # Dev server on port 5173
cd binote && npm run build    # Build to dist/
```

## Architecture

### Directory Structure
- `binote/src/` - React frontend (pages, components, lib)
- `binote/src-tauri/src/` - Rust backend modules

### Backend Modules (Rust)
- `bilibili.rs` - Bilibili API client (video info, audio download)
- `auth.rs` - B站认证模块（QR码扫码登录 + Cookie自动刷新，RSA-OAEP加密）
- `asr/` - ASR 模块目录
  - `mod.rs` - ASR 提供商枚举和统一客户端接口
  - `dashscope.rs` - 阿里云 DashScope ASR 客户端 (qwen3-asr-flash)
  - `sensevoice.rs` - SenseVoice ASR 客户端 (硅基流动)
  - `utils.rs` - 共享工具函数
- `llm.rs` - OpenAI-compatible LLM client for summarization
- `store.rs` - JSON file persistence (config.json, notes.json in app data dir)
- `commands.rs` - Tauri command handlers
- `error.rs` - AppError enum with thiserror

### Frontend Pages
- `Dashboard.tsx` - Main page with note list and Bilibili link input
- `Settings.tsx` - API key configuration, B站扫码登录, ASR provider selection, LLM
- `NoteDetail.tsx` - Transcript and AI summary display

### Tauri Commands (invoke API)
- `get_config()` / `save_config(config)` - Configuration
- `get_notes()` / `get_note(id)` / `delete_note(id)` - Notes CRUD
- `parse_link(input)` - Extract BVID from Bilibili URLs
- `get_video_info(bvid)` - Fetch video metadata
- `transcribe(bvid)` - Full pipeline: download audio → ASR → save note (集成Cookie自动刷新)
- `summarize(noteId)` - Generate AI summary
- `qrcode_generate()` - 生成B站登录二维码
- `qrcode_poll(qrcode_key)` - 轮询扫码状态（成功时自动保存凭证）
- `get_login_status()` - 获取登录状态（自动尝试刷新过期Cookie）
- `logout_bilibili()` - 登出B站账号（清除所有凭证）

### Event Emissions
- `transcribe:progress` - Real-time transcription status
- `summarize:progress` - Real-time summarization status

### Notifications (Android)
- `TranscribeSuccess` - 转录完成通知
- `TranscribeFailed` - 转录失败通知
- `SummarizeSuccess` - AI 总结完成通知
- `SummarizeFailed` - AI 总结失败通知

## Key Patterns

- **Routing**: HashRouter required for Tauri's file:// protocol
- **Styling**: Tailwind CSS with custom pink primary color (#fb7299)
- **Path Alias**: `@/*` maps to `./src/*`
- **Error Handling**: Custom `AppError` enum in Rust, `formatError()` utility in frontend
- **State**: Tauri AppState with Mutex-wrapped Store
- **Async**: tokio runtime in Rust, reqwest for HTTP

## External APIs

1. **Bilibili API** - Video metadata and audio extraction
2. **Bilibili Passport API** - QR码扫码登录 + Cookie刷新 (passport.bilibili.com)
3. **Aliyun DashScope ASR** - Chinese speech-to-text (qwen3-asr-flash)
4. **SenseVoice ASR** - Chinese speech-to-text (硅基流动 SenseVoiceSmall)
5. **OpenAI-compatible LLM** - Summary generation (supports Claude, GPT, etc.)

## 打包 Android APK

**重要**: 由于 Windows 不支持符号链接，需要使用专用脚本打包。

### 一键打包命令

```bash
cd G:/AndroidAPP/biliGPT/binote && ./build-android.sh
```

脚本会自动完成以下 4 步：
1. 编译 Rust 代码 (Tauri + NDK)
2. 复制 so 文件到 jniLibs
3. Gradle 构建 APK
4. 对齐并签名 APK

### 输出文件
- `binote/BiNote-arm64-release-signed.apk` - 签名后的 release APK，可直接安装

### 脚本位置
- `binote/build-android.sh` - 完整打包脚本，包含错误检测和彩色输出

## MCP Routing

Use `gitnexus` for:
- architecture / process exploration (`query`, `context`)
- impact analysis (`impact`, `detect_changes`)
- safe rename (`rename`)
- commit 前后的变更影响分析

Use `jcodemunch` for:
- symbol search (`search_symbols`)
- file / repo outlines (`get_file_outline`, `get_repo_outline`)
- targeted source retrieval (`get_symbol_source`, `get_context_bundle`)
- ranked context assembly (`get_ranked_context`)

Prefer these MCP tools over raw Read/Grep/Glob when available.
Do NOT call both MCPs simultaneously for the same query.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bilinote** (843 symbols, 1495 relationships, 71 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bilinote/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bilinote/clusters` | All functional areas |
| `gitnexus://repo/bilinote/processes` | All execution flows |
| `gitnexus://repo/bilinote/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
