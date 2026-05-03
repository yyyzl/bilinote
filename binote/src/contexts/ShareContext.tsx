/**
 * ShareContext - 全局分享状态管理
 *
 * 此 Context 负责：
 * 1. 注册全局分享处理器
 * 2. 管理待处理的分享 URL
 * 3. 自动导航到 Dashboard 页面
 * 4. 提供分享状态给子组件
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { registerShareHandler, unregisterShareHandler } from '../lib/share';

interface ShareContextType {
  /**
   * 待处理的分享 URL
   * Dashboard 组件监听此值并开始转录
   */
  pendingUrl: string | null;

  /**
   * 消费分享 URL
   * Dashboard 处理完后调用此函数清除 pendingUrl
   */
  consumeShare: () => string | null;

  /**
   * 是否正在处理分享
   */
  isProcessing: boolean;

  /**
   * 设置处理状态
   */
  setIsProcessing: (processing: boolean) => void;
}

const ShareContext = createContext<ShareContextType | null>(null);

export function ShareProvider({ children }: { children: React.ReactNode }) {
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // 使用 ref 避免 useCallback 依赖导致的重新注册
  const locationRef = useRef(location);
  locationRef.current = location;

  // 分享处理函数
  const handleShare = useCallback((url: string) => {
    setPendingUrl(url);

    // 如果不在 Dashboard，自动导航
    if (locationRef.current.pathname !== '/') {
      navigate('/');
    }
  }, [navigate]);

  // 消费分享 URL
  const consumeShare = useCallback(() => {
    const url = pendingUrl;
    setPendingUrl(null);
    return url;
  }, [pendingUrl]);

  // 注册全局分享处理器
  useEffect(() => {
    registerShareHandler(handleShare);

    return () => {
      unregisterShareHandler();
    };
  }, [handleShare]);

  return (
    <ShareContext.Provider value={{
      pendingUrl,
      consumeShare,
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
