# 桌面端 Codex 接入契约

## 入口与配置

- `AppConfig.llm_provider` 为 `api` 或 `codex`，缺失默认 `api`。`codex_model`、`codex_path` 默认空，`codex_fast` 默认 `false`。配置不保存 Codex 认证信息。
- `supports_codex` 仅在 Windows/macOS 返回 `true`，后端同时拒绝其它平台，即使手工导入配置也不能绕过。
- `test_codex_connection(model, executable, fast)` 接收当前未保存的表单参数，返回既有 `ConnectionTestResult`；额度/限流可以是 `warning`，但 `ok` 必须为 `false`。
- 所有总结/导图入口必须走 `GenerationClient`；API 模式沿用 `LlmClient`，Codex 模式不要求 API Key、不自动切换提供商、不自动重试。自动生成失败保留转录结果。

## 执行约束

- `CodexClient` 使用参数数组直接启动原生程序，用户正文只能通过 stdin 输入，不能拼入 shell 命令。
- 自定义路径优先；无效时明确报错。自动检测 PATH、Windows npm 原生包及 macOS Homebrew 常见位置。npm 启动器解析到包内原生程序，不依赖额外 Node 子进程。
- 使用应用缓存下的独立目录、`--no-daemon`、`--ephemeral`、`--ignore-user-config` 和只读沙箱。关闭 shell/unified_exec、hooks、multi_agent、web search、apps、plugins；`project_doc_max_bytes=0` 禁用项目文档加载。不可把这些参数宣传为完全离线或没有任何日志。
- 移除子进程的 `CODEX_API_KEY`、`OPENAI_API_KEY`、`OPENAI_BASE_URL` 环境覆盖，显式设置 OpenAI provider 和 ChatGPT 登录模式；不读取或复制凭据文件。
- 正式执行前用 `codex login status` 只读确认 ChatGPT 登录（最多 10 秒，计入总超时），状态输出不能记录或返回前端。两次调用均使用 `cli_auth_credentials_store="auto"`，兼容系统凭据存储与文件回退。不能跳过检查直接传 `forced_login_method`：认证类型不匹配时 CLI 会注销登录。用户同时在其它窗口更改登录的竞争情况仍需实机验证。
- 普通生成超时 180 秒，测试超时 60 秒；丢弃 future 时清理本次子进程树，不能按进程名结束其它 Codex。

## 输出与错误

- 仅取 JSONL 的 `item.completed` 中非 commentary 的 `agent_message`，必须有 `turn.completed`、非空正文、成功退出状态，且没有失败事件。
- 连接测试额外要求最终正文 trim 后严格等于 `BINOTE_OK`，不能用日志中包含该字符串来判成功。
- 单事件上限 2 MiB，总输出上限 8 MiB；stderr 只保留尾部 16 KiB。协议错误优先于退出时通用日志。
- 诊断只映射到固定中文分类：未安装/路径、登录、模型或速度、额度、限流、网络、版本、超时、协议失败。原始错误、凭据、字幕不得传给前端或写入应用日志。
- CLI 版本变化时，先核对官方非交互文档与本机 help，再调整协议。当前参数核对版本 `0.156.1`；模拟进程测试不能代替真实账户或 macOS 实机验收。

## 验证

在 `binote/src-tauri` 运行 `cargo test --lib`（测试上限 60 秒）；覆盖协议解析、错误分类、输出限制、旧配置默认值、Codex 无 API Key 路由、stdin/退出状态、超时、取消后的进程树退出。前端运行 `npm run build`。

更改模型、程序路径或 Fast 必须清除旧连接测试结果。组件卸载后丢弃异步返回，测试失败不能清空已保存笔记。
