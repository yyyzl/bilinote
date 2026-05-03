# Journal - your-name (Part 1)

> AI development session journal
> Started: 2026-03-20

---



## Session 1: Bootstrap Guidelines - Fill Project Specs

**Date**: 2026-03-20
**Task**: Bootstrap Guidelines - Fill Project Specs

### Summary

(Add summary)

### Main Changes

## Task Completed: Bootstrap Guidelines (00-bootstrap-guidelines)

Analyzed the entire codebase (Rust backend + React frontend) and filled all 11 development guideline files.

### Backend Guidelines (5 files)

| File | Content |
|------|---------|
| `directory-structure.md` | Rust module structure, naming conventions, module declaration pattern |
| `error-handling.md` | AppError enum, Retryable trait, map_err pattern, graceful degradation |
| `database-guidelines.md` | JSON file persistence, Store CRUD patterns, serde(default) strategy |
| `logging-guidelines.md` | Current practice (eprintln + events), recommended tracing setup |
| `quality-guidelines.md` | Forbidden/required patterns, code review checklist, dependencies |

### Frontend Guidelines (6 files)

| File | Content |
|------|---------|
| `directory-structure.md` | React layered architecture (Pages→Components→Lib→Contexts) |
| `component-guidelines.md` | Component template, props conventions, Tailwind theming, a11y |
| `hook-guidelines.md` | Custom hooks, 3 data fetching patterns, memory leak prevention |
| `state-management.md` | useState/Context/Tauri invoke 3-tier state, mutation patterns |
| `type-safety.md` | Strict mode, zero any, type organization, null vs undefined |
| `quality-guidelines.md` | Forbidden patterns, required patterns, code review checklist |

### Updated Files
- `.trellis/spec/backend/directory-structure.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/backend/logging-guidelines.md`
- `.trellis/spec/backend/quality-guidelines.md`
- `.trellis/spec/frontend/directory-structure.md`
- `.trellis/spec/frontend/component-guidelines.md`
- `.trellis/spec/frontend/hook-guidelines.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/frontend/type-safety.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- `.trellis/spec/backend/index.md` (status updated)
- `.trellis/spec/frontend/index.md` (status updated)


### Git Commits

| Hash | Message |
|------|---------|
| `018986a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 2: Brainstorm: B站字幕优先获取 + ASR Fallback

**Date**: 2026-03-20
**Task**: Brainstorm: B站字幕优先获取 + ASR Fallback

### Summary

需求分析和任务规划完成，PRD + context 已落地，等待新上下文实现

### Main Changes

## 会话内容

本次会话完成了「B站字幕优先获取 + ASR Fallback」功能的完整需求分析和规划。

### 分析过程

1. **可行性评估**：分析了 clawhub.ai 的 bilibili-youtube-watcher 技能（基于 yt-dlp），判定 Android 端不可行，但核心逻辑（调用 B站 API）可用 Rust 原生实现
2. **方案对比**：评估了三种方案（纯匿名 / WebView 登录 / SESSDATA 粘贴），确定 SESSDATA 手动粘贴为最佳自用方案
3. **Cookie 必要性确认**：修正了"匿名可获取字幕"的乐观假设，确认大部分字幕获取需要 SESSDATA
4. **过期检测方案**：发现 `/x/web-interface/nav` API 可明确判断登录态，解决了"Cookie过期 vs 视频无字幕"的歧义问题

### 需求确认

| 功能 | 详情 |
|------|------|
| 字幕优先获取 | 转录前先尝试 B站字幕 API |
| ASR Fallback | 字幕失败自动回退到现有 ASR |
| 多P视频支持 | 字幕和 ASR 路径均支持多P，合并时标注分段信息 |
| SESSDATA 配置 | 设置页面新增输入框 + 验证按钮 |
| 过期检测 | 通过 /nav API 明确检测，非探针视频 |
| 来源标记 | Note 记录 transcript_source（subtitle/asr/mixed） |

### 产出

- PRD 文档：`.trellis/tasks/03-20-subtitle-first/prd.md`
- Context 配置：implement.jsonl（13文件）、check.jsonl（9文件）、debug.jsonl（2文件）
- 任务已激活为 current task

### 关键决策 (ADR)

- **SESSDATA 粘贴 > WebView 登录**：开发量 150 行 vs 数千行，自用场景完全够用
- **`/nav` API > 探针视频**：一次轻量请求明确判断登录态，不依赖特定视频存在
- **逐P独立处理**：多P视频中部分P有字幕、部分无字幕时，各P独立选择字幕/ASR路径


### Git Commits

| Hash | Message |
|------|---------|
| `none` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 3: Subtitle-first transcription with ASR fallback

**Date**: 2026-03-20
**Task**: Subtitle-first transcription with ASR fallback

### Summary

(Add summary)

### Main Changes

## Changes

| Area | File | Description |
|------|------|-------------|
| Backend | `error.rs` | Added `SubtitleError` variant |
| Backend | `store.rs` | `AppConfig.bilibili_sessdata`, `Note.transcript_source` |
| Backend | `bilibili.rs` | `PageInfo`, `LoginStatus`, subtitle APIs (get_page_list, check_login_status, get_subtitles, download_subtitle_text, get_subtitle_text) |
| Backend | `asr/mod.rs` | Added `provider_name()` method |
| Backend | `commands.rs` | Rewrote `perform_transcription()` for multi-P + subtitle-first; added `verify_sessdata` command |
| Backend | `lib.rs` | Registered `verify_sessdata` command |
| Frontend | `tauri.ts` | Extended `AppConfig`, `Note`, added `LoginStatus`, `verifySessdata()` |
| Frontend | `Settings.tsx` | Bilibili account section (SESSDATA input + verify button with status feedback) |
| Frontend | `NoteDetail.tsx` | Transcript source badge (subtitle/ASR/mixed) |

## API Verification

Tested with real SESSDATA against B站 APIs:
- `/x/web-interface/nav` — login validation ✅
- `/x/player/pagelist` — page list retrieval ✅
- `/x/player/v2` — subtitle list (ai-zh) ✅
- Subtitle JSON download + text extraction ✅

## Build Verification

- `cargo check` — 0 errors, 0 warnings ✅
- `npx tsc --noEmit` — 0 errors ✅


### Git Commits

| Hash | Message |
|------|---------|
| `48deb26` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 4: Fix subtitle fetching and LLM hallucination

**Date**: 2026-03-20
**Task**: Fix subtitle fetching and LLM hallucination

### Summary

(Add summary)

### Main Changes

## 问题排查

用户反馈：通过 API 获取的字幕回填到"完整转录"区域时内容异常（如显示不相关的三国台词），但 AI 总结看起来正常。

### 排查过程

1. **追踪数据流**：字幕获取 → 存储 → 前端展示 → LLM 总结
2. **发现 `.join("")` 无分隔拼接问题**（已修复为 `\n`）
3. **深入分析发现 LLM 幻觉**：当 transcript 内容不足时，LLM 基于 title 编造总结
4. **参考 bilibili-youtube-watcher skill**：发现应使用 yt-dlp 的方式（wbi/v2 端点）
5. **实际调用 B站 API 验证**：用用户 SESSDATA 确认字幕完整（BV1fMwyzkEPQ: 187条 2437字）

### 修复内容

| 文件 | 改动 |
|------|------|
| `bilibili.rs` | wbi/v2 端点、CC字幕优先选择、质量检查、去重去HTML、超时15s |
| `commands.rs` | 字幕质量校验 + fallback ASR |
| `llm.rs` | 防幻觉 prompt 约束 |

### 验证

- API 测试确认两个视频字幕均完整（2437字 / 3090字）
- cargo check 编译通过
- Android APK 打包成功（20MB）


### Git Commits

| Hash | Message |
|------|---------|
| `cc137cf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 5: feat: 通知点击跳转到笔记详情页

**Date**: 2026-04-08
**Task**: feat: 通知点击跳转到笔记详情页

### Summary

(Add summary)

### Main Changes

## 实现内容

点击转录/总结/思维导图完成的推送通知后，App 直接导航到对应笔记详情页。

| 层 | 文件 | 变更 |
|----|------|------|
| Rust | `notification.rs` | NotificationType 增加 note_id，写导航目标文件，auto_cancel |
| Rust | `commands.rs` | 5 处 send_notification 传入 note_id |
| Android | `MainActivity.kt` | 处理通知 Intent，读文件，WebView JS 注入（带重试） |
| Frontend | `notification-nav.ts` | 通知点击缓冲+分发模块（新建） |
| Frontend | `NotificationNavContext.tsx` | React Context 注册 navigate handler（新建） |
| Frontend | `main.tsx` / `App.tsx` | 注册全局回调函数和 Provider |

## 关键决策

1. **放弃 Tauri notification 插件 `onAction()` API**：发现 `sourceJson` 在即时通知中为 null，导致 `extra` 数据丢失
2. **采用文件跨层通信模式**：Rust 写文件 → Android 读文件 → WebView JS 注入，复用分享功能已验证的架构
3. **跨层常量同步**：`.notification_nav_target` 文件名在 Rust/Kotlin 两端保持一致

## Spec 更新

- `cross-layer-thinking-guide.md`：新增 Tauri notification plugin gotcha + 文件跨层通信模式
- `component-guidelines.md` / `state-management.md`：新增 Android↔WebView 三层桥接模式


### Git Commits

| Hash | Message |
|------|---------|
| `cd4f8b7` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 6: fix: Latest Entry 卡片点击跳转

**Date**: 2026-04-08
**Task**: fix: Latest Entry 卡片点击跳转

### Summary

修复 Dashboard 页面 Latest Entry 区块点击无反应的问题

### Main Changes

| 改动 | 说明 |
|------|------|
| Dashboard.tsx | 将 Latest Entry 外层 `<div>` 替换为 `<Link to={/note/${latestNote.id}}>` |

**根因**: Latest Entry 区块使用的是普通 `<div>`，缺少路由导航，而笔记列表项使用的是 `<Link>` 组件

**验证**: `latestNote = notes[0]`，后端 `save_note` 用 `insert(0, note)` 将新笔记插入数组头部，确保始终指向最新笔记


### Git Commits

| Hash | Message |
|------|---------|
| `89ba5e6` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
