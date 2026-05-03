/**
 * 通知点击导航模块
 *
 * 架构模式与 share.ts 完全一致：
 * - Android 端 MainActivity.kt 通过 evaluateJavascript 调用全局函数
 * - 缓冲区暂存 React 未就绪时收到的 note_id
 * - React Context 就绪后注册 handler 并消费缓冲区
 *
 * 数据流：
 * Rust send_notification() → 写 .notification_nav_target 文件
 * → 用户点击通知 → Android Intent → MainActivity.onNewIntent()
 * → 读取文件获取 note_id → evaluateJavascript("window.__BINOTE_NOTIFICATION_CLICK__(noteId)")
 * → 本模块 receiveNotificationClick() → navHandler(noteId) → navigate(`/note/${noteId}`)
 */

/**
 * note_id 缓冲区
 * 在 React 加载完成前暂存从通知点击中收到的 note_id
 */
let pendingNoteId: string | null = null;

/**
 * React 回调函数
 * 由 NotificationNavProvider 注册，用于处理导航
 */
let navHandler: ((noteId: string) => void) | null = null;

/**
 * 标记 React 是否已准备好接收导航指令
 */
let isReactReady = false;

/**
 * Android 调用的全局函数
 * 如果 React 已准备好，直接调用 handler；否则存入缓冲区
 *
 * @param noteId - 笔记 ID
 * @returns 是否成功处理（true=立即处理，false=已缓冲）
 */
export function receiveNotificationClick(noteId: string): boolean {
  if (isReactReady && navHandler) {
    navHandler(noteId);
    return true;
  } else {
    pendingNoteId = noteId;
    return false;
  }
}

/**
 * React 组件调用 — 注册导航处理器
 * 如果有缓冲的 note_id，立即处理
 *
 * @param handler - 导航处理函数，接收 noteId 并执行路由跳转
 */
export function registerNavHandler(
  handler: (noteId: string) => void,
): void {
  navHandler = handler;
  isReactReady = true;

  // 处理缓冲的 note_id
  if (pendingNoteId) {
    const id = pendingNoteId;
    pendingNoteId = null;
    handler(id);
  }
}

/**
 * React 组件调用 — 注销导航处理器
 * 注意：不设置 isReactReady = false，因为 App 级别的 handler 不应该被卸载
 */
export function unregisterNavHandler(): void {
  navHandler = null;
  // 保持 isReactReady = true，因为 React 仍在运行
}

/**
 * 检查通知导航处理器是否就绪
 * 供 Android 端轮询检测（备用）
 */
export function isNotificationHandlerReady(): boolean {
  return isReactReady && navHandler !== null;
}
