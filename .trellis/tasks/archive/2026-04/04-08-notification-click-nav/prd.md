# 通知点击跳转到笔记详情页

## 问题描述

当前点击转录/总结/思维导图完成的推送通知后，App 只会打开主页（Dashboard），不会跳转到对应的笔记详情页。

## 期望行为

用户点击成功类通知（转录完成、总结完成、思维导图完成）后，App 应直接导航到对应笔记的详情页 (`/note/{id}`)。

## 需求范围

### 必须实现

1. `NotificationType` 的所有 Success 变体增加 `note_id: String` 字段
2. `send_notification()` 使用 `.extra("note_id", &note_id)` 将 `note_id` 附加到通知
3. 前端使用 `onAction()` 监听通知点击事件，提取 `note_id` 并导航到 `/note/{id}`
4. 使用 `.auto_cancel()` 让通知点击后自动消失

### 不需要实现

- 不需要修改 `MainActivity.kt`（Tauri notification 插件已内置通知点击 Intent 处理）
- 不需要在 Rust `lib.rs` 注册事件监听（插件自身已处理）
- 失败类通知不需要跳转（因为没有对应的 note_id）

## 技术约束

- 使用 Tauri notification 插件 v2 内置的 `onAction()` API
- 前端监听需在 `App.tsx` 或 Context 层注册（Router 内部，可使用 `useNavigate`）
- 通知的 `extra` 数据通过 `actionPerformed` 事件中的 `notification` 字段传递
