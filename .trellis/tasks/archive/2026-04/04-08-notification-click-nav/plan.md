# 通知点击跳转到笔记详情页 — 执行计划

## Inputs

- PRD: `prd.md`
- Design: `info.md`
- Relevant specs:
  - `.trellis/spec/backend/error-handling.md` — AppError 模式，`eprintln!` 用于非关键错误
  - `.trellis/spec/frontend/component-guidelines.md` — Context/Hook 模式，isMountedRef 模式

## File Map

- Modify: `binote/src-tauri/src/notification.rs` — NotificationType 枚举增加 note_id；send_notification 使用 .extra() 和 .auto_cancel()
- Modify: `binote/src-tauri/src/commands.rs` — 所有 send_notification 调用传入 note_id
- Create: `binote/src/lib/notification-nav.ts` — 通知点击导航模块（缓冲 + handler 注册，复用 share.ts 的架构模式）
- Modify: `binote/src/main.tsx` — 注册全局 notification action 监听器（早期注册）
- Create: `binote/src/contexts/NotificationNavContext.tsx` — 通知导航 Context（在 Router 内注册 navigate 处理）
- Modify: `binote/src/App.tsx` — 在 ShareProvider 旁添加 NotificationNavProvider

## Execution Slices

### Slice 1: Rust 端 — NotificationType 增加 note_id 并附加到通知

**Goal**

让成功类通知携带 `note_id`，通过 `.extra("note_id", ...)` 附加到 Android 通知中。

**Files**

- `binote/src-tauri/src/notification.rs`
- `binote/src-tauri/src/commands.rs`

**Steps**

- [x] 修改 `notification.rs` 中的 `NotificationType` 枚举

  所有 Success 变体增加 `note_id: String` 字段：
  - `TranscribeSuccess { title: String, note_id: String }`
  - `TranscribeAndSummarizeSuccess { title: String, note_id: String }`
  - `TranscribeSuccessSummarizeFailed { title: String, note_id: String }`
  - `SummarizeSuccess { title: String, note_id: String }`
  - `MindmapSuccess { title: String, note_id: String }`

  Failed 变体保持不变（无 note_id 可传）。

- [x] 修改 `send_notification()` 函数

  从 match 中提取 `note_id`（Option），在构建通知时：
  ```rust
  let mut builder = notification.builder().title(title).body(&body).auto_cancel();
  if let Some(id) = note_id {
      builder = builder.extra("note_id", &id);
  }
  ```

- [x] 更新 `commands.rs` 中所有 `send_notification` 调用点

  共 7 处调用，成功类调用需传入 `note.id.clone()`：

  1. 第 532 行 `TranscribeAndSummarizeSuccess` — 加 `note_id: note.id.clone()`
  2. 第 549 行 `TranscribeSuccessSummarizeFailed` — 加 `note_id: note.id.clone()`
  3. 第 553 行 `TranscribeSuccess` — 加 `note_id: note.id.clone()`
  4. 第 589 行 `TranscribeFailed` — 无需改动
  5. 第 794 行 `SummarizeSuccess` — 加 `note_id: note.id.clone()`
  6. 第 813 行 `SummarizeFailed` — 无需改动
  7. 第 941 行 `MindmapSuccess` — 加 `note_id: note.id.clone()`
  8. 第 960 行 `MindmapFailed` — 无需改动

- [x] 编译验证
  - Command: `cd G:/AndroidAPP/biliGPT/binote && cargo check --manifest-path src-tauri/Cargo.toml`
  - Expected: 编译通过，无 warning（所有 match 分支都已更新）

### Slice 2: 前端 — 通知点击导航模块 + Context + 全局注册

**Goal**

前端监听通知点击事件，提取 `note_id`，导航到 `/note/{id}`。采用与 `share.ts` / `ShareContext` 相同的架构模式：早期缓冲 + Context 内注册 navigate handler。

**Files**

- `binote/src/lib/notification-nav.ts`（新建）
- `binote/src/contexts/NotificationNavContext.tsx`（新建）
- `binote/src/main.tsx`
- `binote/src/App.tsx`

**Steps**

- [x] 创建 `binote/src/lib/notification-nav.ts`

  ```typescript
  /**
   * 通知点击导航模块
   *
   * 在 React 加载前就开始监听 Tauri notification 插件的 actionPerformed 事件，
   * 在 React 准备好后将 note_id 传递给 NotificationNavContext 处理导航。
   */
  import { onAction } from "@tauri-apps/plugin-notification";
  import type { PluginListener } from "@tauri-apps/api/core";

  let pendingNoteId: string | null = null;
  let navHandler: ((noteId: string) => void) | null = null;
  let isReactReady = false;
  let listenerUnlisten: PluginListener | null = null;

  /**
   * 初始化通知点击监听（在 main.tsx 中调用，React 渲染前）
   */
  export function initNotificationListener(): void {
    onAction((event: any) => {
      const noteId = event?.notification?.extra?.note_id;
      if (typeof noteId !== "string" || !noteId) return;

      if (isReactReady && navHandler) {
        navHandler(noteId);
      } else {
        pendingNoteId = noteId;
      }
    }).then((listener) => {
      listenerUnlisten = listener;
    });
  }

  /**
   * React 组件调用 — 注册导航处理器
   */
  export function registerNavHandler(handler: (noteId: string) => void): void {
    navHandler = handler;
    isReactReady = true;

    if (pendingNoteId) {
      const id = pendingNoteId;
      pendingNoteId = null;
      handler(id);
    }
  }

  /**
   * React 组件调用 — 注销导航处理器
   */
  export function unregisterNavHandler(): void {
    navHandler = null;
  }
  ```

- [x] 创建 `binote/src/contexts/NotificationNavContext.tsx`

  参考 `ShareContext.tsx` 的架构模式：
  ```typescript
  import { useEffect, useCallback, useRef } from "react";
  import { useNavigate, useLocation } from "react-router-dom";
  import { registerNavHandler, unregisterNavHandler } from "../lib/notification-nav";

  export function NotificationNavProvider({ children }: { children: React.ReactNode }) {
    const navigate = useNavigate();
    const location = useLocation();
    const locationRef = useRef(location);
    locationRef.current = location;

    const handleNotificationNav = useCallback((noteId: string) => {
      navigate(`/note/${noteId}`);
    }, [navigate]);

    useEffect(() => {
      registerNavHandler(handleNotificationNav);
      return () => { unregisterNavHandler(); };
    }, [handleNotificationNav]);

    return <>{children}</>;
  }
  ```

- [x] 修改 `binote/src/main.tsx`

  在 React 渲染之前调用 `initNotificationListener()`：
  ```typescript
  import { initNotificationListener } from "./lib/notification-nav";
  // 注册通知点击导航监听器（在 React 渲染之前）
  initNotificationListener();
  ```

- [x] 修改 `binote/src/App.tsx`

  在 `ShareProvider` 旁添加 `NotificationNavProvider`：
  ```typescript
  import { NotificationNavProvider } from "./contexts/NotificationNavContext";

  // 在 <ShareProvider> 内部添加
  <ShareProvider>
    <NotificationNavProvider>
      <Routes>...</Routes>
    </NotificationNavProvider>
  </ShareProvider>
  ```

- [x] 前端编译验证
  - Command: `cd G:/AndroidAPP/biliGPT/binote && npx tsc --noEmit`
  - Expected: TypeScript 编译通过

### Slice 3: 端到端验证

**Goal**

打包 APK 并在设备上验证通知点击跳转功能。

**Files**

- 无新增文件

**Steps**

- [ ] 构建 Android APK
  - Command: `cd G:/AndroidAPP/biliGPT/binote && ./build-android.sh`
  - Expected: 构建成功，生成 `BiNote-arm64-release-signed.apk`

- [ ] 设备测试清单
  1. 启动 App，触发一个转录任务
  2. 转录完成后收到通知
  3. 点击通知 → App 应直接打开对应笔记的详情页
  4. 重复测试：App 在前台 / App 在后台 / App 被杀掉三种场景
  5. 验证失败类通知点击后打开 App 主页（不崩溃）

## Risks / Watch Items

- **`onAction` 的 event 结构**：Tauri notification 插件的 `actionPerformed` 事件中，`extra` 数据嵌套在 `event.notification.extra` 中。如果结构不符，需要在 Slice 2 中调整解析逻辑。可以在 `initNotificationListener` 中加 `console.log` 打印完整 event 对象来调试。
- **App 被杀掉的场景**：如果 App 完全未运行，点击通知会走 `onCreate` → `NotificationPlugin.load()` 中的 `onIntent(activity.intent)` 路径。此时 `onAction` 监听器可能还未注册。`notification-nav.ts` 的缓冲机制 (`pendingNoteId`) 应该能处理这种情况，但需要实际测试确认。
- **`auto_cancel()` 兼容性**：确认 `.auto_cancel()` 在 Android 上能让通知点击后自动消失。

## Ready-to-Execute Summary

- First slice to start with: Slice 1
- Blocking dependencies: Slice 2 依赖 Slice 1 完成（需要后端先能发送带 extra 的通知）；Slice 3 依赖 Slice 1 + 2
