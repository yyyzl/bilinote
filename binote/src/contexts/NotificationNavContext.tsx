/**
 * NotificationNavContext - 通知点击导航处理
 *
 * 此 Context 负责：
 * 1. 注册通知点击的导航处理器
 * 2. 接收来自 notification-nav.ts 的 note_id
 * 3. 自动导航到对应笔记详情页
 *
 * 架构模式与 ShareContext 一致：
 * - 在 Router 内部提供 useNavigate
 * - 通过 registerNavHandler / unregisterNavHandler 管理生命周期
 */

import { useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  registerNavHandler,
  unregisterNavHandler,
} from "../lib/notification-nav";
import * as api from "../lib/tauri";

export function NotificationNavProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const isMountedRef = useRef(true);
  const isCheckingPendingNavRef = useRef(false);

  // 通知点击处理：导航到笔记详情页
  const handleNotificationNav = useCallback(
    (noteId: string) => {
      const normalizedNoteId = noteId.trim();
      if (normalizedNoteId) {
        navigate(`/note/${normalizedNoteId}`);
      }
    },
    [navigate],
  );

  const syncPendingNotificationNav = useCallback(async () => {
    if (isCheckingPendingNavRef.current) return;
    isCheckingPendingNavRef.current = true;

    try {
      const noteId = await api.consumeNotificationNavTarget();
      if (isMountedRef.current && noteId) {
        handleNotificationNav(noteId);
      }
    } catch (e) {
      console.error(e);
    } finally {
      isCheckingPendingNavRef.current = false;
    }
  }, [handleNotificationNav]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // 注册导航处理器
  useEffect(() => {
    registerNavHandler(handleNotificationNav);

    return () => {
      unregisterNavHandler();
    };
  }, [handleNotificationNav]);

  useEffect(() => {
    void syncPendingNotificationNav();

    const handleFocus = () => {
      void syncPendingNotificationNav();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncPendingNotificationNav();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncPendingNotificationNav]);

  return <>{children}</>;
}
