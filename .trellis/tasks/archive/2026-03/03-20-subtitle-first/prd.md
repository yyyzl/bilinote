# B站字幕优先获取 + ASR Fallback（含多P支持）

## Goal

在转录 B 站视频时，优先尝试通过 B 站 API 获取视频已有字幕（CC字幕/AI字幕），获取成功则直接使用，失败或无字幕时自动 fallback 到现有 ASR 转录流程。同时支持多P视频的完整处理（字幕和 ASR 路径均支持多P）。目标是大幅降低有字幕视频的转录耗时和 API 费用。

## Requirements

### 核心功能

* **字幕优先获取**：转录前先尝试获取 B 站现有字幕，成功则跳过音频下载和 ASR
* **ASR Fallback**：字幕获取失败（任何原因）自动 fallback 到 ASR，不阻塞主流程
* **多P视频支持**：获取分P列表，逐P处理（字幕/ASR），合并结果并标注分段信息
* **SESSDATA 过期检测**：通过 `/x/web-interface/nav` API 明确判断 Cookie 是否过期
* **Note 来源标记**：记录 transcript 来源（subtitle / asr / mixed）

### 设置页面

* 新增"B站账号"配置区块，包含 SESSDATA 输入框
* 提供"验证"按钮，调用 `/nav` API 检测 SESSDATA 有效性
* 验证结果即时反馈（有效/已过期/网络错误）

### 进度提示

* 展示当前阶段：验证登录态 → 检查字幕 → 使用字幕/使用ASR
* 多P视频显示分P进度：`正在处理 P2/5: 核心概念...`

## Technical Approach

### 转录流程（多P + 字幕优先）

```
获取视频信息(bvid) → 获取分P列表(pagelist API)
  ↓
有 SESSDATA？
  ├── 否 → 全部P走ASR（原流程，扩展为多P）
  └── 是 → 验证 SESSDATA（/nav API）
        ├── 无效（code=-101）→ 提示"SESSDATA已过期" → 全部P走ASR
        └── 有效（isLogin=true）→ 逐P处理：
              每个P：
                尝试获取字幕(player/v2)
                  → 有字幕？下载字幕JSON，拼接文本
                  → 无字幕？下载该P音频 → ASR转录
  ↓
合并所有P的文本
  单P：纯文本，不加分段标记
  多P：添加分段标记 【P1: 标题】\n内容\n\n【P2: 标题】\n内容
  ↓
记录 transcript_source（subtitle / asr / mixed）
保存 Note
```

### B站 API 清单

| API | 用途 | 认证 |
|-----|------|------|
| `x/web-interface/view?bvid=` | 获取视频信息 | 无需 |
| `x/player/pagelist?bvid=` | 获取分P列表 | 无需 |
| `x/web-interface/nav` | 验证登录态 | SESSDATA |
| `x/player/v2?bvid=&cid=` | 获取字幕列表 | SESSDATA |
| `aisubtitle.hdslb.com/...` | 下载字幕JSON | 无需 |
| `x/player/playurl?avid=&cid=` | 获取音频URL | 无需 |

### 文件改动清单

**后端（Rust）：**

| 文件 | 改动 |
|------|------|
| `bilibili.rs` | 新增：`PageInfo` 结构体、`get_page_list()`、`get_subtitles()`、`download_subtitle_json()`、`check_login_status()` |
| `commands.rs` | 修改：`perform_transcription()` 支持多P+字幕优先；新增：`verify_sessdata` command |
| `store.rs` | `AppConfig` 新增 `bilibili_sessdata`；`Note` 新增 `transcript_source` |
| `error.rs` | 可能新增 `SubtitleError` 变体 |
| `lib.rs` | 注册 `verify_sessdata` command |

**前端（React）：**

| 文件 | 改动 |
|------|------|
| `tauri.ts` | `AppConfig` + `Note` 类型扩展；新增 `verifySessdata()` |
| `Settings.tsx` | 新增"B站账号"配置区块（SESSDATA输入 + 验证按钮） |
| `NoteDetail.tsx` | 显示字幕来源标签 |

### 分段合并格式

**单P视频（不加标记）：**
```
大家好，今天来讲一下...
接下来我们看...
```

**多P视频（添加分段标记）：**
```
【P1: 引言】
大家好，今天来讲一下...

【P2: 核心概念】
接下来我们看...

【P3: 实战演练】
现在我们动手做...
```

### transcript_source 取值

| 值 | 含义 |
|----|------|
| `"subtitle"` | 所有P均通过字幕获取 |
| `"asr"` | 所有P均通过 ASR 转录 |
| `"mixed"` | 部分P用字幕，部分P用 ASR |
| `null` | 历史数据（兼容旧Note） |

### SESSDATA 验证机制

```
调用 GET https://api.bilibili.com/x/web-interface/nav
Header: Cookie: SESSDATA=xxx

响应判断：
- code=0 且 data.isLogin=true → 有效
- code=-101 → 无效/过期
- 网络错误 → 不确定，提示用户
```

## Decision (ADR-lite)

**Context**: 需要在纯 Android 端获取 B站字幕，存在认证要求。
**Decision**: 采用手动粘贴 SESSDATA + `/nav` API 验证方案，而非 WebView 登录。
**Consequences**:
- 优势：开发量极小，维护成本趋近零，功能效果等同
- 劣势：用户需手动从浏览器复制 SESSDATA（自用可接受）
- 风险：B站 API 变更（概率低，且有 ASR 兜底）

## Acceptance Criteria

* [ ] 单P视频 + 有效 SESSDATA + 有字幕 → 使用字幕，不走 ASR
* [ ] 单P视频 + 有效 SESSDATA + 无字幕 → fallback ASR
* [ ] 多P视频 + 有字幕 → 合并所有P字幕，含分段标记
* [ ] 多P视频 + 部分P有字幕 → 混合模式（字幕+ASR），source=mixed
* [ ] 多P视频 + 无字幕 → 全部P走 ASR，含分段标记
* [ ] SESSDATA 过期 → `/nav` 检测到 → 提示过期 → 全部走 ASR
* [ ] 未配置 SESSDATA → 直接走 ASR
* [ ] 网络错误/超时 → fallback ASR
* [ ] 设置页面可输入/清空 SESSDATA
* [ ] 设置页面"验证"按钮正确反馈有效/过期/网络错误
* [ ] Note 中 transcript_source 正确记录来源
* [ ] 前端 NoteDetail 展示来源标签
* [ ] 进度事件正确反映当前状态和多P进度
* [ ] 旧 Note（无 transcript_source）正常显示，无兼容问题

## Definition of Done

* Lint / typecheck pass (`cargo check` + `npm run build`)
* 前后端类型定义一致
* 旧数据兼容（transcript_source 为 Option）
* CLAUDE.md 更新（如有新 command 或结构变化）

## Out of Scope

* WebView 登录获取 Cookie
* 集成 yt-dlp
* Cookie 自动刷新/续期
* 字幕翻译功能
* 字幕时间轴保留（仅提取文本）
* 选择性下载部分P（全P处理）

## Technical Notes

* B站字幕 API：`https://api.bilibili.com/x/player/v2?bvid={}&cid={}`
* 分P列表 API：`https://api.bilibili.com/x/player/pagelist?bvid={}`
* 登录态验证 API：`https://api.bilibili.com/x/web-interface/nav`
* 字幕 JSON URL 格式：`https://aisubtitle.hdslb.com/bfs/ai_subtitle/xxx.json`
* 字幕 JSON 结构：`{ "body": [{ "from": 0.0, "to": 3.5, "content": "文本" }] }`
* 分P列表结构：`{ "data": [{ "cid": 123, "page": 1, "part": "标题", "duration": 600 }] }`
* Nav API 结构：`{ "code": 0, "data": { "isLogin": true, "uname": "xxx" } }`
* 字幕获取超时：5秒（独立于音频下载超时）
* SESSDATA 验证超时：5秒
