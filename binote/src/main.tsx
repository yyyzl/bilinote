import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/manrope/latin-400.css";
import "@fontsource/manrope/latin-500.css";
import "@fontsource/manrope/latin-600.css";
import "@fontsource/manrope/latin-700.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/newsreader/latin-700.css";
import App from "./App";
import "./styles/globals.css";

// 导入分享模块
import { receiveShareFromAndroid, isShareHandlerReady } from "./lib/share";

// 导入通知导航模块
import { receiveNotificationClick } from "./lib/notification-nav";

// ========================================
// 早期注册全局函数（在 React 渲染之前）
// 这样即使 React 还没加载完成，Android 也能调用
// ========================================

declare global {
  interface Window {
    __BINOTE_RECEIVE_SHARE__?: (url: string) => boolean;
    __BINOTE_SHARE_READY__?: () => boolean;
    __BINOTE_NOTIFICATION_CLICK__?: (noteId: string) => boolean;
  }
}

// 注册分享接收函数
window.__BINOTE_RECEIVE_SHARE__ = receiveShareFromAndroid;

// 注册就绪检测函数（供 Android 轮询检测）
window.__BINOTE_SHARE_READY__ = isShareHandlerReady;

// 注册通知点击接收函数（供 Android MainActivity 调用）
window.__BINOTE_NOTIFICATION_CLICK__ = receiveNotificationClick;

// ========================================
// React 应用渲染
// ========================================

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
