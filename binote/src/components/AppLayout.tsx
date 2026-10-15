import { type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowLeft, Settings } from "lucide-react";

interface AppLayoutProps {
  children: ReactNode;
  reader?: boolean;
}

export default function AppLayout({
  children,
  reader = false,
}: AppLayoutProps) {
  const location = useLocation();
  const isSettings = location.pathname === "/settings";
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <Link to="/" className="brand" aria-label="BiNote 首页">
            <span>BiNote</span>
            <span className="brand-mark" aria-hidden="true" />
          </Link>
          <Link to={isSettings ? "/" : "/settings"} className="header-action">
            {isSettings ? (
              <ArrowLeft size={18} aria-hidden="true" />
            ) : (
              <Settings size={18} aria-hidden="true" />
            )}
            <span>{isSettings ? "返回笔记库" : "设置"}</span>
          </Link>
        </div>
      </header>
      <main className={`workspace-main ${reader ? "workspace-reader" : ""}`}>
        {children}
      </main>
    </div>
  );
}
