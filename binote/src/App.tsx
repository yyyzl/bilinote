import { useEffect } from "react";
import { HashRouter, Routes, Route, useLocation } from "react-router-dom";
import { ShareProvider } from "./contexts/ShareContext";
import { NotificationNavProvider } from "./contexts/NotificationNavContext";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import NoteDetail from "./pages/NoteDetail";

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return null;
}

function App() {
  return (
    <HashRouter>
      {/* ShareProvider 必须在 Router 内部，因为需要 useNavigate */}
      <ShareProvider>
        {/* NotificationNavProvider 监听通知点击，导航到对应笔记 */}
        <NotificationNavProvider>
          <ScrollToTop />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/note/:id" element={<NoteDetail />} />
          </Routes>
        </NotificationNavProvider>
      </ShareProvider>
    </HashRouter>
  );
}

export default App;
