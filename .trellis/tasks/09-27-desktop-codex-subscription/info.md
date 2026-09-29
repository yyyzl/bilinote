# 技术设计

## 跨层契约

- AppConfig 新增 `llm_provider: "api" | "codex"`（默认 api）、`codex_model: string | null`、`codex_path: string | null`、`codex_fast: boolean`（默认 false）。保留现有 API 配置，切换提供商不丢失已填内容。
- `supports_codex() -> bool`：仅 Windows/macOS 返回 true。
- `test_codex_connection(model: String, executable: Option<String>, fast: bool) -> ConnectionTestResult`：以当前未保存表单值测试；最多 60 秒；有效回复且成功结束才是 ok。限流/额度提示 warning 但 ok=false；其它错误为 error。
- 新 `GenerationClient::from_config` 统一所有生成入口。API 继续使用 LlmClient；Codex 通过 stdin 输入既有提示词，JSONL 返回最终 agent_message。Codex 不自动重试或切换 API。

## 进程与协议

- 优先发现原生 codex / codex.exe，包括 PATH、Windows npm 包内 vendor 路径、macOS Homebrew 路径；手动路径仅接受可执行文件，不解释命令文本。
- 参数数组启动，无 shell 拼接；Windows 隐藏窗口。子进程移除 API Key 环境覆盖，强制 openai 提供商和 chatgpt 登录。
- `--ignore-user-config`、独立应用工作目录、只读沙箱、关闭 shell、unified_exec、hooks、multi_agent、web search、apps、plugins，限制无关能力；不修改用户全局配置。
- 进程退出、错误和输出协议都需检查；截断诊断数据，返回固定中文错误分类，不向前端暴露 stderr/令牌/字幕。
- 测试请求只要求返回 `BINOTE_OK`，使用正式生成执行器；普通生成超时 180 秒。取消时销毁进程，平台进程树清理只针对本次启动的进程。

## 认证检查修正

官方 [认证说明](https://learn.chatgpt.com/docs/auth) 明确指出 `forced_login_method` 与已存认证类型不匹配时会注销用户。因此正式执行前增加只读 `codex login status` 检查，仅接受 ChatGPT 登录标记；API Key、未登录或未知输出均停止执行并提示手动登录，不展示账号信息。检查与生成统一 `cli_auth_credentials_store="auto"`，避免跳过用户配置后遗漏系统凭据存储。状态原文可能包含密钥片段，绝不返回或记录。

## 验证矩阵

| 类别 | 输入 | 预期 |
| --- | --- | --- |
| Good | 最终消息 + turn.completed + exit 0 | 返回非空文本 |
| Base | 含进度、reasoning、未知事件的 JSONL | 只提取最终消息 |
| Bad | turn.failed、非零退出、空消息、损坏 JSON、超长行 | 失败，不保存错误为笔记 |
| Bad | 过期登录、无效模型、额度耗尽、运行时缺失 | 中文可操作提示；不得误显示通过 |
| Bad | 测试中修改模型或路径 | 丢弃旧测试结果 |
| Platform | Android 读取 Codex 配置 | 后端明确拒绝，前端不显示入口 |

## 涉及文件

- 新增 `binote/src-tauri/src/codex.rs`：运行时定位、进程、输出解析、错误分类、真实测试。
- 新增 `binote/src-tauri/src/generation.rs`：提供商适配。
- 修改 `store.rs`、`commands.rs`、`lib.rs`、`llm.rs`：配置、命令、统一路由和复用提示词。
- 修改 `src/lib/tauri.ts`、`src/pages/Settings.tsx`；新增 `src/components/CodexSettings.tsx`。
- 更新 `.trellis/spec/backend/` 的相关契约与 `binote/README.md` 使用说明。
