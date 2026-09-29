# 验证记录

## 2026-09-28 Windows 打包与真实链路验收

用户明确要求自行打包并在本机测试。本轮运行 `npm run desktop:build` 成功，生成 Windows x64 EXE 安装包与 MSI；通过 Computer Use 操作此次构建的 `target/release/binote.exe`，没有覆盖 `D:/BiNote` 的旧安装。

| 检查 | 结果 |
| --- | --- |
| `gpt-6-luna` 标准模式连接 | 成功，界面显示 12059 ms |
| `gpt-6-luna` Fast 连接 | 成功，界面显示 7248 ms |
| 无效模型 `binote-invalid-model-for-test` | 正确返回中文模型/速度不可用错误，没有误报成功 |
| 修改模型或 Fast | 旧测试结果清除 |
| 保存配置 | 成功；当前 `codex / gpt-6-luna / fast=true` |
| 总结生成 | 518 字符，Markdown 正常显示并保存 |
| 思维导图生成 | 232 字符 Mermaid，图形正常渲染并保存 |
| 重启发布版 | 测试笔记仍显示总结和导图均已生成 |
| 原有笔记 | 与测试前备份逐项比较，185 条全部未变 |

测试使用一条公开合成文本笔记，ID 为 `codex-smoke-20260928`，标题「Codex 本机验收（测试笔记）」，保留在应用内供继续验收。真实模型共进行两次成功探测、一次无效模型探测、一次总结和一次导图生成；没有查询剩余额度。上述耗时是单次观测，不代表性能基准。

产物：

- `binote/src-tauri/target/release/binote.exe`（本机实测的发布版）
- `binote/src-tauri/target/release/bundle/nsis/BiNote_0.4.1_x64-setup.exe`，5,298,300 字节，SHA256 `336397DACE351E3F6A4F561103C60334D84CBD7CEB9DC4D7C47D42C062D1B2CC`
- `binote/src-tauri/target/release/bundle/msi/BiNote_0.4.1_x64_en-US.msi`，7,512,064 字节，SHA256 `0E7FDA442ADB3C5AFB291F96D4E3D85534D83D6E499EEBB4AF2C5FED06380F47`

安装器本身未执行安装/卸载验收；本轮验证的是其同次构建的发布程序。macOS、Android 交叉构建和跨客户端同时切换认证的竞争情况仍未验证。

## 先前自动检查（2026-09-27）

- `cargo test --lib`：13 项测试通过，测试执行 0.72 秒；每次测试命令设置 60 秒上限。
- `cargo check`：Windows 编译通过。
- `npm run build`：TypeScript 严格检查和 Vite 构建通过；保留现有 Browserslist 数据过旧、产物体积提示，没有升级依赖。
- `git -c core.whitespace=cr-at-eol diff --check`：通过。原有 Git 文件为 CRLF，保留行尾而不制造全文件换行改动；该选项仅作用于本次命令。
- 本机 `codex-cli 0.156.1` help 核对；只读 `login status` 的结果仅在内存中转换为两个布尔值，确认当前版本的 ChatGPT 登录标记。没有输出状态原文、读取凭据文件或发送模型请求。

## 测试覆盖

JSONL 最终消息/完成事件、进度与推理排除、失败事件、非零退出、空结果、损坏协议、超大输出、诊断上限、登录类型、固定错误分类与敏感内容不回传、测试标记严格匹配、stdin 输入、请求超时、取消后子进程及后代管道关闭、旧配置默认 API、Codex 无需 API Key、参数和 API 环境隔离。

## 变更范围与质量复核

- 修改前逐符号 GitNexus impact 为 LOW；整体 detect-changes 报 CRITICAL，30 个符号、23 条关联流程。已向用户说明，原因范围包含 Settings、AppConfig、应用命令注册和转录后生成入口。
- 人工核对 API 请求实现未改动；共享提示词只调整可见性。所有总结/导图入口统一路由；登录检查只在 Codex 分支执行。同步总结补上应用退出取消。
- GitNexus 结果存在文档节点/相邻符号命中，且未跟踪新增文件不能仅靠 diff 映射覆盖；新增执行器、路由及 UI 已单独检查。
- verify-change 脚本通过，但其新增行数统计为 0 且误判 DESIGN.md 状态，不能据此宣称已覆盖设计；真实设计记录位于 info.md，使用文档和后端契约已同步。
- verify-quality 实际扫描 Rust 目录 17 个文件，无错误。Codex 文件长度提示包含同文件协议/进程夹具测试，长行主要是测试 JSON/脚本；原有 commands.rs、bilibili.rs 也有文件长度提示。TSX 未被该脚本支持，使用 TypeScript 编译及人工复核，未将零文件扫描当作有效通过。

## 先前遗留项的当前状态

- 真实 Codex 模型、Fast 与 Windows 桌面交互已于 2026-09-28 验证，详见上表；没有测量实际额度消耗。
- macOS 构建、运行时定位、凭据存储和进程组清理需对应设备验证；Android 的入口隐藏与后端拒绝已实现，未交叉编译。
- 用户在其它客户端同时切换登录时的竞争情况需实机观察；当前只读预检可避免普通 API Key 登录被测试流程直接注销。

## 人工验收

Windows/macOS 安装并登录 Codex 后，选择 Codex 订阅、填写可用模型，点击测试连接，成功后保存；分别生成总结和导图，并验证无效模型、未登录、取消和 API 模式切回。错误时检查字幕/已有笔记保留。此阶段会消耗账户额度。

没有提交、发布、安装全局依赖或修改用户 Codex 配置。原有未跟踪文件未改动。
