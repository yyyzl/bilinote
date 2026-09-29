# 执行计划

输入：prd.md、info.md，以及已读取的前后端规范和跨层指南。

## S1：Codex 执行与协议

状态：已实现并通过 Windows 模拟进程测试。补充只读登录方式检查，避免认证不匹配时注销已有登录。

- 在 `binote/src-tauri/src/codex.rs` 先写 JSONL 完成/失败/空内容、测试标记和诊断脱敏测试；注册模块并运行定向测试确认缺少实现。
- 实现原生运行时定位、参数构造、stdin/stdout/stderr、超时与子进程清理，补充伪子进程协议测试。
- 检查：在 `binote/src-tauri` 运行 `cargo test --lib codex::tests`，测试进程最长 60 秒。

## S2：配置与生成路由

状态：已实现，旧配置默认值和 Codex 无 API Key 路由测试、Rust 编译通过。

- 在 `generation.rs` 添加旧配置默认 API、Codex 不依赖 API Key、空模型及非桌面拒绝测试，先确认失败再实现。
- 更新 `store.rs` 配置、`commands.rs` 全部生成入口和连接测试、`lib.rs` 注册；复用 `llm.rs` 提示词。
- 检查：`cargo test --lib generation::tests`，随后 `cargo check`。

## S3：桌面设置与验证

状态：代码、前端构建与变更复核完成；2026-09-28 Windows 发布版及真实账户桌面交互验收通过，macOS 实机验证待完成，详见 verification.md。

- 更新 `src/lib/tauri.ts` 类型及调用；`Settings.tsx` 提供商入口与保存；`CodexSettings.tsx` 模型、路径、Fast 和连接测试。
- 沿用当前样式，处理测试中表单变化和组件卸载；不新增低价值 UI 单元测试。
- 检查：`npm run build`、相关 Rust 测试、`git diff --check`、GitNexus detect-changes 和人工差异复核。
- 更新 README 与契约文档。实账号调用不在自动验证中触发，注明 Windows/macOS 实机验证边界。

## 风险与边界

- 官方 CLI 参数有版本要求，缺少能力时返回升级提示。
- 不记录凭据，不安装全局依赖，不修改用户 Codex 配置，不调用真实模型测试。
