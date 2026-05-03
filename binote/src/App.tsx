import { HashRouter, Routes, Route } from "react-router-dom";
import { ShareProvider } from "./contexts/ShareContext";
import { NotificationNavProvider } from "./contexts/NotificationNavContext";
import Dashboard from "./pages/Dashboard";
import Settings from "./pages/Settings";
import NoteDetail from "./pages/NoteDetail";

function App() {
  return (
    <HashRouter>
      {/* ShareProvider 必须在 Router 内部，因为需要 useNavigate */}
      <ShareProvider>
        {/* NotificationNavProvider 监听通知点击，导航到对应笔记 */}
        <NotificationNavProvider>
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
