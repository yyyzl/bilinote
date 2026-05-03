# 通知点击跳转 — 技术设计

## 核心发现

Tauri notification 插件 v2 (2.3.3) 已经内置了完整的通知点击处理链路：

1. **Android 端** (`TauriNotificationManager.kt`):
   - `buildIntent()` 创建 PendingIntent，附带 `NOTIFICATION_OBJ_INTENT_KEY`（通知的完整 JSON，包括 extra）
   - 点击通知时 Intent 通过 `FLAG_ACTIVITY_SINGLE_TOP` 发送到 Activity

2. **插件层** (`NotificationPlugin.kt`):
   - `onNewIntent()` → `onIntent()` → `handleNotificationActionPerformed()`
   - 从 Intent 提取通知 JSON，包装为 `{ actionId: "tap", notification: {...} }`
   - 调用 `trigger("actionPerformed", dataJson)` 发送到前端

3. **前端 API** (`@tauri-apps/plugin-notification`):
   - `onAction(cb)` 监听 `actionPerformed` 事件
   - 回调参数包含完整的通知对象（包括 `extra` 字段）

## 数据流

```
Rust: send_notification(.extra("note_id", id))
  ↓ [Android 系统通知]
User clicks notification
  ↓ [PendingIntent → Activity]
NotificationPlugin.onNewIntent()
  ↓ [handleNotificationActionPerformed]
trigger("actionPerformed", { actionId: "tap", notification: { extra: { note_id: "xxx" } } })
  ↓ [Plugin listener]
Frontend: onAction(cb) → cb({ notification: { extra: { note_id: "xxx" } } })
  ↓ [React Router]
navigate(`/note/${noteId}`)
```

## 参考模式

项目已有 Android → WebView 的通信模式（分享功能），但本功能**不需要复用该模式**，
因为 Tauri notification 插件已提供了更优雅的原生解决方案。

## Capabilities 权限

当前 `default.json` 中已有 `notification:default` 和 `notification:allow-notify`。
`onAction()` 使用 `addPluginListener`，属于 notification 插件内部事件，
不需要额外的 capability 权限。
