/**
 * 分享状态管理模块
 *
 * 此模块在 React 加载之前就能接收来自 Android 的分享 URL，
 * 并在 React 准备好后将 URL 传递给 ShareContext 处理。
 */

/**
 * 分享 URL 缓冲队列
 * 在 React 加载完成前暂存从 Android 接收的 URL（支持连续多条，不互相覆盖）
 */
let pendingShareUrls: string[] = [];

/**
 * React 回调函数
 * 由 ShareProvider 注册，用于处理分享 URL
 */
let shareHandler: ((url: string) => void) | null = null;

/**
 * 标记 React 是否已准备好接收分享
 */
let isReactReady = false;

/**
 * Android 调用的全局函数
 * 如果 React 已准备好，直接调用 handler；否则存入缓冲区
 *
 * @param url - 分享的 URL
 * @returns 是否成功处理（true=立即处理，false=已缓冲）
 */
export function receiveShareFromAndroid(url: string): boolean {
  if (isReactReady && shareHandler) {
    shareHandler(url);
    return true;
  } else {
    // 入队缓冲（去重），等 React 就绪后一次性回放
    if (!pendingShareUrls.includes(url)) {
      pendingShareUrls.push(url);
    }
    return false;
  }
}

/**
 * React 组件调用 - 注册分享处理器
 * 如果有缓冲的 URL，立即处理
 *
 * @param handler - 分享处理函数
 */
export function registerShareHandler(handler: (url: string) => void): void {
  shareHandler = handler;
  isReactReady = true;

  // 回放所有缓冲的 URL
  if (pendingShareUrls.length > 0) {
    const urls = pendingShareUrls;
    pendingShareUrls = [];
    for (const url of urls) {
      handler(url);
    }
  }
}

/**
 * React 组件调用 - 注销分享处理器
 * 注意：不设置 isReactReady = false，因为 App 级别的 handler 不应该被卸载
 */
export function unregisterShareHandler(): void {
  shareHandler = null;
  // 保持 isReactReady = true，因为 React 仍在运行
}

/**
 * 检查 React 是否已准备好
 * 供 Android 端 JS 调用检测
 */
export function isShareHandlerReady(): boolean {
  return isReactReady && shareHandler !== null;
}
