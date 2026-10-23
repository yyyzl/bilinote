# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Rust module organization and file layout | Done |
| [Database Guidelines](./database-guidelines.md) | JSON persistence, Store CRUD patterns | Done |
| [Error Handling](./error-handling.md) | AppError enum, retry, error propagation | Done |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns, review checklist | Done |
| [Logging Guidelines](./logging-guidelines.md) | Current practice + future recommendations | Done |
| [Codex Integration](./codex-integration.md) | 桌面端 Codex 进程、配置与连接验证契约 | Done |
| [Summary and Preview](./summary-preview-contract.md) | 同次生成、可选预览、旧笔记与错误回退契约 | Done |
| [Task History](./task-history-contract.md) | 终态记录移除、重试清理、并发产物更新契约 | Done |
| [Android Live Notifications](./android-live-notifications-contract.md) | Private task snapshot, native promotion/fallback, dismissal, navigation and reproducible Android builds | Done |
| [Android Signing](./android-signing-contract.md) | 历史证书固定、密钥缺失阻断与覆盖升级数据保留 | Done |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
