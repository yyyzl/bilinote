# 桌面端 Codex 订阅接入

## 目标

在 BiNote 的 Windows 和 macOS 桌面端提供 Codex 订阅接入，通过本机 `codex exec` 与已有 ChatGPT 登录使用账户额度生成视频总结和思维导图。

## 已确认

- 用户选择 Codex SDK / App Server + ChatGPT 登录路线，接受作为桌面端专属功能。
- 用户明确选择首版复用已安装的本机 Codex，在 BiNote 中连接账户并选择模型。
- 用户要求评估方案并提出改进建议，随后提出是否有类似 Claude Code print 模式的直接输出命令；已验证 `codex exec`。
- 当前 React + Tauri / Rust 应用已支持 API Key、Base URL、模型名称配置，通过 OpenAI 兼容的 Chat Completions 接口生成文本。
- 官方 App Server 提供账户登录、模型发现、额度状态和流式生成；SDK 需要 Node.js 服务端环境。

## 已收敛范围

- Windows、macOS 提供 Codex 接入入口；Android 继续使用 API 接入。
- 文本总结和思维导图共用接入方式，语音转录流程沿用现有实现。
- 使用官方托管 ChatGPT 登录，不手工复制令牌，不将账户凭据写入应用配置。
- 用户手动填写模型名称，不读取账户详情、可用模型列表或剩余额度。
- 提供与现有 API 测试一致的“测试 Codex 连接”按钮，通过同一生成执行器发送极短请求，验证安装、认证、所填模型和返回结果；测试提示会消耗少量额度。
- 复用 CLI 已有 ChatGPT 登录；未登录时提示先执行 `codex login`，首版不内嵌登录流程。
- 自动定位 Codex，允许高级用户手填原生可执行文件路径；默认标准速度，可选择 Fast。
- 额度耗尽、登录失效、运行时缺失时给出可操作的提示；不自动切换到付费 API。

## 调研结论（2026-09-27）

- 本机安装 `codex-cli 0.156.1`；已读取 `exec --help`、`login --help`、`app-server --help`，并在系统临时目录生成本机版本的协议类型。没有读取凭据或运行模型。
- `codex exec` 默认将最终消息写入 stdout，进度写入 stderr；支持 stdin 输入、`--json` 事件流、`--output-schema` 结构化结果、`-o` 最终消息文件、`--ephemeral`、`--skip-git-repo-check`、`--ignore-user-config`。`-p` 在 Codex 中代表 profile。
- `--ignore-user-config` 跳过用户 config.toml，认证仍使用 CODEX_HOME；它不等于禁用全部工具、技能或项目指令。具体工具隔离和工作目录必须另行验证。
- App Server 提供结构化账户登录、model/list、额度信息、增量消息、turn/interrupt，适合完整客户端。当前文档对 app-server 命令及 WebSocket 标注实验性限制，需要评估版本兼容。
- 本机协议类型包含模型 serviceTiers、默认服务等级、ephemeral、baseInstructions、outputSchema 等字段；字段存在不等于账户支持相应模型或速度档位。
- 当前自动生成逻辑把同一份字幕分别发送给总结和导图请求，并用 tokio::join! 并行；引入 Codex 后需要单独评估并发和启动开销。
- 总结入口包括同步 summarize、后台 summarize_background、转录后自动生成；导图入口包括 mindmap_background 和转录后自动生成。所有入口应使用统一提供商路由。
- 已刷新 GitNexus 索引；AppConfig 查询命中前端接口，上游分析为 LOW，4 个直接文件引用、6 个总受影响节点，未识别受影响执行流程。索引返回的部分行号与工作区不一致，具体位置以本地源码为准，不能将此次结果代替后续逐符号影响分析。

## 可选技术路线

| 路线 | 适用场景 | 取舍 |
| --- | --- | --- |
| Rust 子进程调用 codex exec | 一次输入字幕，返回总结或导图 | 首版生成链路最简单；需处理进程取消、退出码、stdout/stderr、运行时定位；完整模型列表和额度 UI 需额外接口 |
| Rust 通过 stdio 连接 App Server | 内嵌登录、模型列表、额度、流式对话 | 功能完整；需维护 JSON-RPC 请求匹配、服务端事件和版本兼容 |
| TypeScript Codex SDK | Node.js 服务端已有运行环境 | 当前 Tauri Rust 项目会额外引入 Node 运行时，首版收益较小 |

**决定**：用户进一步确认不需要账户、模型列表和额度管理，首版采用 Rust 调用 `codex exec`，模型手填，提供真实链路测试。App Server 和 Node SDK 不纳入首版。

## 实现约束

- Rust 直接构造子进程参数，字幕从 stdin 传入，不能拼接进 shell 命令。
- Windows 处理 npm 安装的启动器与原生可执行文件定位，隐藏后台窗口；macOS 处理 GUI 应用与终端 PATH 不一致，提供手动选择运行时的入口。
- 只选择 ChatGPT 认证模式，拒绝无意继承 API Key / 自定义提供商；不复制认证令牌。
- 使用独立工作目录，明确固定提示词与输出格式，并验证不会加载无关项目指令、工具、插件或 hooks。
- `--ephemeral` 只表示不持久化会话文件，不应宣传为没有任何日志、没有远端处理或完全离线。
- JSONL 模式需要识别最终 agent_message、turn.failed/error 与进程退出码，不能把整段事件流保存成笔记，也不能承诺逐 token 输出能力。
- 超时和用户取消要终止对应进程及相关子进程；错误时保留字幕和已有笔记结果，不自动重复消耗额度。
- 模型手填，速度默认标准；不支持的模型或速度由真实链路测试返回明确错误。

## 可验证的改进想法

1. 若总结和导图同时启用，评估一次返回 `{summary, mindmap}` 的结构化结果，减少重复提交字幕；单独重新生成仍支持单项。实际额度收益必须实测，不能承诺减少一半。
2. 对同一字幕、提示词版本和模型参数建立结果复用，避免重复点击生成；显式重新生成时允许绕过缓存。
3. 提供“均衡 / 更快”的简单速度选择和本次 token 用量（可获取时），并提示消耗与平时 Codex 共用的额度。

## 后续验证

- 选取短字幕、长字幕、口语重复、专业术语和格式噪声等代表样本，比较现有 API、Luna 标准模式、Luna Fast。
- 记录首个可见输出时间、总时间、JSON/Markdown/Mermaid 有效率、信息遗漏和输入/输出 token；额度百分比只能作为粗粒度观察。
- 先用协议夹具验证正常完成、错误、空结果、取消、超时和旧版本参数不支持；真实账户生成需另行运行。
- Windows 可在本机验证；macOS 需要对应设备或 CI 构建与实测，不能由 Windows 检查推断已通过。

## 验收标准

- [ ] Windows/macOS 可选择 Codex，Android 不显示该入口且后端拒绝不支持的调用。
- [x] 能发现运行时、复用已有 ChatGPT 登录、手填模型，并验证实际生成链路（Windows 发布版通过）。
- [x] 视频总结和思维导图通过选定的 Codex 模型生成，支持现有进度及失败展示（Windows 发布版通过）。
- [x] 旧配置可加载，API 路由保留（配置回归测试通过；未发送真实 API 请求）。
- [x] Windows 模拟进程验证退出、超时、取消后的进程树清理；macOS 待实测。
- [x] 应用执行器不把原始诊断、凭据或字幕写入日志；CLI 自身日志行为遵循其配置。
- [x] 完成相关类型检查、Rust 检查与针对协议和路由的最小测试。

代码实现已完成，2026-09-28 Windows 发布版真实账户验收通过；跨平台入口验收仍待 macOS 实测与 Android 交叉编译，安装器安装流程也未验收。详见 `verification.md`。

## 暂不包含

- App Server、账户管理、动态模型列表、额度面板和内置 Codex 安装包。
- 合并总结/导图单次生成与缓存，作为后续优化候选。
- 安卓连接桌面桥接服务。
- 多用户共享一个订阅账户或云端转发服务。
- 用 Codex 替换音频转录。

## 技术资料

- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/codex-sdk
- https://learn.chatgpt.com/docs/auth
- https://learn.chatgpt.com/docs/agent-configuration/speed
- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/config-file/config-reference
- 当前接入点：`binote/src-tauri/src/llm.rs`、`binote/src/pages/Settings.tsx`。
