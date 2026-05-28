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
- `main.rs` - Binary entry; delegates to `lib::run()`
- `lib.rs` - Tauri Builder, AppState wiring, `generate_handler!` registry (authoritative command list)
- `commands.rs` - Tauri command handlers (sync + background `start_*` variants, task lifecycle)
- `bilibili.rs` - Bilibili API client: link parsing (b23.tv / BV / av / 复制带标题的整段文本), video info, multi-page (分 P) list, audio stream, official subtitles
- `auth.rs` - B站扫码登录 + Cookie 自动刷新 (RSA-OAEP)
- `asr/` - ASR provider abstraction + two implementations
  - `mod.rs` - `AsrProvider` enum + unified client
  - `dashscope.rs` - Aliyun DashScope (qwen3-asr-flash)
  - `sensevoice.rs` - SiliconFlow SenseVoiceSmall
  - `utils.rs` - shared helpers
- `llm.rs` - OpenAI-compatible LLM client (summary + mindmap generation)
- `notification.rs` - System notifications + notification-tap navigation (`consume_notification_nav_target`)
- `retry.rs` - Retry / backoff helpers used by network calls
- `store.rs` - JSON persistence (`config.json`, `notes.json` in app data dir)
- `error.rs` - `AppError` enum with `thiserror`

> Heads-up: `commands.rs.backup` is a stale local snapshot of an earlier `commands.rs` — ignored via `.gitignore` (`*.backup`). Do not import from it.

### Frontend Pages
- `Dashboard.tsx` - Main page: note list, Bilibili link input, share-URL intake, background task progress
- `Settings.tsx` - API key configuration, B站扫码登录, ASR provider selection, LLM endpoint/model
- `NoteDetail.tsx` - Transcript + AI summary + Mermaid mindmap, copy buttons

### Frontend Building Blocks
- `components/MermaidRenderer.tsx` - Renders mindmap Mermaid source from LLM
- `components/CopyButton.tsx` - One-click copy for transcript / summary
- `components/ConfirmModal.tsx` / `ErrorModal.tsx` - Reusable dialogs
- `contexts/ShareContext.tsx` + `lib/share.ts` - Receive share URLs from Android (`receiveShareFromAndroid` is exposed pre-React-ready)
- `contexts/NotificationNavContext.tsx` + `lib/notification-nav.ts` - Notification-tap → route bridge
- `lib/tauri.ts` - Strongly-typed wrappers around `invoke` / `event.listen`

### Tauri Commands (invoke API)

Authoritative list lives in `binote/src-tauri/src/lib.rs` inside `generate_handler!`. Grouped:

- **Config**: `get_config()` / `save_config(config)`
- **Notes CRUD**: `get_notes()` / `get_note(id)` / `delete_note(id)`
- **Bilibili API**: `parse_link(input)` / `get_video_info(bvid)`
- **Transcription**: `transcribe(bvid)` (sync, legacy) / `start_transcribe(bvid)` (background, returns `task_id`)
- **Summary**: `summarize(noteId)` (sync, legacy) / `start_summarize(noteId)` (background)
- **Mindmap**: `start_mindmap(noteId)` (background; emits Mermaid source)
- **Task control**: `get_task_status(task_id)` / `cancel_task(task_id)`
- **B站 Auth**: `qrcode_generate()` / `qrcode_poll(qrcode_key)` / `verify_sessdata(sessdata)` / `get_login_status()` / `logout_bilibili()`
- **Notification routing**: `consume_notification_nav_target()`

Prefer `start_*` background variants for long-running work — they wire into the task registry (`AppState::tasks` / `task_handles`) so the UI can cancel and observe progress without blocking.

### Subtitle-first transcription strategy

`commands.rs::resolve_subtitle_access` runs before any ASR call: if the user is logged in and the video exposes official subtitles long enough to be useful, those are used directly (zero ASR cost, faster, more accurate). ASR is only invoked when subtitles are missing, too short, or the fetch fails. Auto Cookie refresh kicks in inside this path when SESSDATA expires.

### Event Emissions
- `transcribe:progress` - Transcription pipeline status (subtitle probe, audio download, ASR, save…)
- `summarize:progress` - LLM summary stream / phase messages
- `mindmap:progress` - Mindmap generation phase messages

### Notifications (both desktop and Android via tauri-plugin-notification)
- `TranscribeSuccess` / `TranscribeFailed` - 转录完成 / 失败
- `SummarizeSuccess` / `SummarizeFailed` - AI 总结完成 / 失败
- Tapping a notification triggers route navigation through `notification-nav` (frontend) / `consume_notification_nav_target` (backend).

## Key Patterns

- **Routing**: HashRouter required for Tauri's file:// protocol
- **Styling**: Tailwind CSS with an editorial paper aesthetic — terracotta primary (#b75d3e), warm canvas/paper neutrals, ink-toned text, sage/gold accents, Manrope (sans) + Newsreader (serif) font pairing. Visual language sits close to Claude.ai.
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
