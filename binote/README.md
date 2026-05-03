# BiNote - B站 AI 笔记助手

一款优雅的 B站视频转录和 AI 总结工具，基于 Tauri v2 + Rust + React 构建。

## 功能特性

- 🎬 支持多种 B站链接格式（b23.tv 短链、BV号、av号、完整URL）
- 🎙️ 使用阿里云 DashScope ASR 进行语音转文字
- 🤖 支持 OpenAI 兼容的 LLM API 生成智能总结
- 💾 本地存储笔记，保护隐私
- 🎨 iOS 风格的简洁界面
- 🧹 自动清理临时音频文件

## 技术栈

| 层级 | 技术 |
|-----|------|
| 框架 | Tauri v2 |
| 后端 | Rust |
| 前端 | React + TypeScript |
| 样式 | Tailwind CSS |
| ASR | 阿里云 DashScope (qwen3-asr-flash) |
| LLM | OpenAI 兼容格式 |

## 快速开始

### 前置要求

- Node.js 18+
- Rust 1.70+
- npm 或 yarn

### 安装依赖

```bash
cd binote
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建应用

```bash
npm run tauri build
```

### 构建 macOS 应用

macOS 的 `.app` 和 `.dmg` 必须在 macOS 环境生成，Windows 只能做配置和代码检查。

在 Mac 上运行：

```bash
cd binote
bash build-macos.sh
```

也可以手动执行：

```bash
cd binote
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm ci
npm run mac:build
```

输出目录：

```text
binote/src-tauri/target/universal-apple-darwin/release/bundle/macos/
binote/src-tauri/target/universal-apple-darwin/release/bundle/dmg/
```

如果没有 Apple Developer 证书，默认脚本会生成未签名包。首次打开可能需要在 macOS 的“隐私与安全性”里手动允许。需要签名和公证时，在 Mac 上配置证书后运行：

```bash
npm run mac:build:signed
```

GitHub 仓库也可以在 Actions 页面手动触发 `Build macOS` 工作流，产物会上传为 `BiNote-macOS` artifact。

## 使用说明

### 1. 配置 API 密钥

首次使用需要配置 API 密钥：

1. 点击右上角的 "⚙️ 设置" 按钮
2. 填写以下信息：
   - **ASR API Key**: 阿里云 DashScope API Key
   - **LLM API Key**: OpenAI 或兼容服务的 API Key
   - **LLM Base URL**: API 端点（默认：https://api.openai.com/v1）
   - **LLM Model**: 模型名称（默认：gpt-4o-mini）
3. 点击"保存配置"

### 2. 转录视频

1. 复制 B站视频链接（支持以下格式）：
   - 短链接：`https://b23.tv/xxxxx`
   - BV号：`BV1xxx`
   - av号：`av123456`
   - 完整URL：`https://www.bilibili.com/video/BV1xxx`
2. 粘贴到首页输入框
3. 点击"✨ 开始解析"
4. 等待转录完成（进度会实时显示）

### 3. 生成 AI 总结

1. 在首页点击笔记的"查看详情"
2. 点击"✨ 生成 AI 总结"按钮
3. 等待 LLM 生成结构化笔记

## 项目结构

```
binote/
├── src-tauri/              # Rust 后端
│   └── src/
│       ├── main.rs         # 应用入口
│       ├── bilibili.rs     # B站 API 客户端
│       ├── asr.rs          # DashScope ASR
│       ├── llm.rs          # LLM 客户端
│       ├── store.rs        # 数据存储
│       ├── commands.rs     # Tauri 命令
│       └── error.rs        # 错误处理
├── src/                    # React 前端
│   ├── pages/
│   │   ├── Dashboard.tsx   # 首页
│   │   ├── Settings.tsx    # 设置页
│   │   └── NoteDetail.tsx  # 笔记详情
│   └── lib/
│       └── tauri.ts        # Tauri API 封装
└── package.json
```

## 限制说明

- 音频文件大小限制：15MB（约5分钟视频）
- 转录完成后会自动删除临时音频文件

## 开发说明

### Rust 命令

| 命令 | 功能 |
|------|------|
| `get_config` / `save_config` | 配置管理 |
| `get_notes` / `get_note` / `delete_note` | 笔记管理 |
| `parse_link` | 解析 B站链接 |
| `transcribe` | 转录视频（含下载、ASR、清理） |
| `summarize` | LLM 总结 |

### 数据存储

- 配置文件：`{app_data_dir}/config.json`
- 笔记文件：`{app_data_dir}/notes.json`
- 临时音频：`{app_data_dir}/temp/` （自动清理）

## License

MIT
