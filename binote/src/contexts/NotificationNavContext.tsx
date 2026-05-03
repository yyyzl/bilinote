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

import { useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  registerNavHandler,
  unregisterNavHandler,
} from "../lib/notification-nav";

export function NotificationNavProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const navigate = useNavigate();

  // 通知点击处理：导航到笔记详情页
  const handleNotificationNav = useCallback(
    (noteId: string) => {
      navigate(`/note/${noteId}`);
    },
    [navigate],
  );

  // 注册导航处理器
  useEffect(() => {
    registerNavHandler(handleNotificationNav);

    return () => {
      unregisterNavHandler();
    };
  }, [handleNotificationNav]);

  return <>{children}</>;
}
