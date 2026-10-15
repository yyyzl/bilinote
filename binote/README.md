# BiNote

应用源码目录。完整说明（功能、下载、打包、API 配置等）请见仓库根目录 [`README.md`](../README.md)。

Windows / macOS 已接入本机 `codex exec`：设置页选择「Codex 订阅」，手填模型并测试连接后保存。需先安装 Codex CLI 并执行 `codex login`；详细步骤与验证边界见根目录说明。

## 子目录速览

| 路径 | 说明 |
|------|------|
| `src/` | React + TypeScript 前端 |
| `src-tauri/` | Rust + Tauri 后端 |
| `scripts/build-macos.mjs` | macOS 打包入口（被 `npm run mac:build` 调用） |
| `scripts/verify-ui.cjs` / `verify-flows.cjs` / `verify-interactions.cjs` / `verify-inline-tasks.cjs` / `verify-flat-layout.cjs` / `verify-task-recovery.cjs` / `verify-task-consistency.cjs` | 页面、业务流程与慢请求/失败恢复回归，不调用真实服务 |
| `DESIGN.md` | 界面结构、预览契约与验证说明 |
| `build-android.sh` | 本地 Android 打包脚本（Windows 友好） |
| `build-macos.sh` | 本地 macOS 打包脚本 |

## 常用命令

```bash
npm install                # 安装依赖
npm run tauri dev          # 开发模式
npm run tauri build        # 桌面端打包（当前平台）
npm run mac:build          # macOS universal 打包（仅 macOS）
npm run build              # TypeScript 与前端生产构建
npm run test:unit          # Rust 单元测试（进程上限 60 秒）
npm run test:ui            # 离线浏览器回归（需先启动 Vite 和准备 Playwright）
bash build-android.sh      # Android APK 打包（含签名）
```
