/**
 * ShareContext - 全局分享状态管理
 *
 * 此 Context 负责：
 * 1. 注册全局分享处理器
 * 2. 管理待处理的分享 URL 队列（支持连续多条分享并发入队）
 * 3. 自动导航到 Dashboard 页面
 * 4. 提供分享状态给子组件
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { registerShareHandler, unregisterShareHandler } from '../lib/share';

interface ShareContextType {
  /**
   * 待处理的分享 URL 队列
   * Dashboard 组件监听此值并逐个开始转录
   */
  pendingUrls: string[];

  /**
   * 取出并清空所有待处理的分享 URL
   * Dashboard 消费后调用，返回本次取到的全部 URL
   */
  consumeShares: () => string[];

  /**
   * 是否正在处理分享 / 后台任务
   */
  isProcessing: boolean;

  /**
   * 设置处理状态
   */
  setIsProcessing: (processing: boolean) => void;
}

const ShareContext = createContext<ShareContextType | null>(null);

export function ShareProvider({ children }: { children: React.ReactNode }) {
  // ref 持有权威队列，state 仅用于触发重渲染，避免 setState 异步导致 consume 读到旧值
  const pendingRef = useRef<string[]>([]);
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // 使用 ref 避免 useCallback 依赖导致的重新注册
  const locationRef = useRef(location);
  locationRef.current = location;

  // 分享处理函数：入队（去重）并按需导航到首页
  const handleShare = useCallback((url: string) => {
    if (!pendingRef.current.includes(url)) {
      pendingRef.current = [...pendingRef.current, url];
      setPendingUrls(pendingRef.current);
    }

    // 如果不在 Dashboard，自动导航
    if (locationRef.current.pathname !== '/') {
      navigate('/');
    }
  }, [navigate]);

  // 取出并清空整个分享队列
  const consumeShares = useCallback(() => {
    const taken = pendingRef.current;
    pendingRef.current = [];
    setPendingUrls([]);
    return taken;
  }, []);

  // 注册全局分享处理器
  useEffect(() => {
    registerShareHandler(handleShare);

    return () => {
      unregisterShareHandler();
    };
  }, [handleShare]);

  return (
    <ShareContext.Provider value={{
      pendingUrls,
      consumeShares,
      isProcessing,
      setIsProcessing
    }}>
      {children}
    </ShareContext.Provider>
  );
}

/**
 * Hook to access share context
 * @throws Error if used outside ShareProvider
 */
export function useShare(): ShareContextType {
  const context = useContext(ShareContext);
  if (!context) {
    throw new Error('useShare must be used within ShareProvider');
  }
  return context;
}
