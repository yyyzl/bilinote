# BiNote

应用源码目录。完整说明（功能、下载、打包、API 配置等）请见仓库根目录 [`README.md`](../README.md)。

## 子目录速览

| 路径 | 说明 |
|------|------|
| `src/` | React + TypeScript 前端 |
| `src-tauri/` | Rust + Tauri 后端 |
| `scripts/build-macos.mjs` | macOS 打包入口（被 `npm run mac:build` 调用） |
| `build-android.sh` | 本地 Android 打包脚本（Windows 友好） |
| `build-macos.sh` | 本地 macOS 打包脚本 |

## 常用命令

```bash
npm install                # 安装依赖
npm run tauri dev          # 开发模式
npm run tauri build        # 桌面端打包（当前平台）
npm run mac:build          # macOS universal 打包（仅 macOS）
bash build-android.sh      # Android APK 打包（含签名）
```
