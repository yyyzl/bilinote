# Component Guidelines

> How components are built in this project.

---

## Overview

All components are **React functional components** written in **TypeScript**. The project uses:
- **Default exports** for all page and component files
- **Props interfaces** defined at the top of each file
- **Tailwind CSS** for all styling (no CSS modules, no styled-components)
- **Lucide React** for icons

---

## Component Structure

### Standard Component Template

```typescript
// components/ExampleComponent.tsx

// 1. Imports
import { useState, useCallback } from "react";
import { SomeIcon } from "lucide-react";

// 2. Props interface
interface ExampleComponentProps {
  title: string;
  onAction: () => void;
  isDisabled?: boolean;  // Optional props use ?
}

// 3. Component function (default export)
export default function ExampleComponent({ title, onAction, isDisabled = false }: ExampleComponentProps) {
  // 4. Hooks at the top
  const [loading, setLoading] = useState(false);

  // 5. Event handlers
  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      await onAction();
    } finally {
      setLoading(false);
    }
  }, [onAction]);

  // 6. Render
  return (
    <div className="p-4 bg-white rounded-xl">
      <h3 className="text-lg font-semibold">{title}</h3>
      <button
        onClick={handleClick}
        disabled={isDisabled || loading}
        className="px-4 py-2 bg-primary-500 text-white rounded-lg"
      >
        {loading ? "处理中..." : "确认"}
      </button>
    </div>
  );
}
```

### Page Component Template

```typescript
// pages/ExamplePage.tsx

import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import * as api from "@/lib/tauri";
import { formatError } from "@/components/ErrorModal";
import ErrorModal from "@/components/ErrorModal";

export default function ExamplePage() {
  // State
  const [data, setData] = useState<api.SomeType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isMountedRef = useRef(true);  // Memory leak prevention

  // Data loading
  const loadData = useCallback(async () => {
    try {
      const result = await api.getData();
      if (isMountedRef.current) setData(result);
    } catch (e) {
      if (isMountedRef.current) setError(formatError(e));
    }
  }, []);

  // Lifecycle
  useEffect(() => {
    isMountedRef.current = true;
    loadData();
    return () => { isMountedRef.current = false; };
  }, [loadData]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Page content */}
      <ErrorModal error={error} onClose={() => setError("")} />
    </div>
  );
}
```

---

## Props Conventions

### Typing Rules

```typescript
// ✅ Use interface for component props
interface ModalProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;     // Optional with default value
  cancelText?: string;
  confirmStyle?: string;    // Tailwind class override
}

// ✅ Destructure props with defaults
export default function Modal({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = "确认",     // Default values in destructuring
  cancelText = "取消",
  confirmStyle = "bg-primary-500",
}: ModalProps) {}
```

### Naming Conventions

| Prop Type | Naming Pattern | Example |
|-----------|---------------|---------|
| Boolean | `is*` or `has*` | `isDisabled`, `hasError` |
| Callback | `on*` | `onClose`, `onConfirm`, `onClick` |
| Data | Descriptive noun | `title`, `message`, `notes` |
| Style override | `*Style` or `*ClassName` | `confirmStyle` |
| Optional | Use `?` suffix in interface | `error?: string` |

---

## Styling Patterns

### Tailwind CSS (Primary Method)

```typescript
// ✅ Inline Tailwind classes
<div className="bg-white rounded-2xl border shadow-sm hover:shadow-xl
                hover:shadow-primary-500/10 transition-all duration-300">
```

### Theme Colors

2026-10-15 用户确认绿色知识工作台，替代旧纸感视觉。源文件为 `binote/tailwind.config.js` 与 `src/styles/globals.css`。

| 角色 | Token / class | 值 |
|------|---------------|----|
| 顶栏 | `.app-header` | `#1b2c24` |
| 画布 | `canvas-50` | `#f3f6f2` |
| 表面 | `paper-50` | `#ffffff` |
| 主操作 | `.button-primary` | `#cbea78`，深色文字 |
| 功能强调 | `primary-500` | `#4f7c42` |
| 文字 | `ink-900` | `#15271d` |
| 次要文字 | `ink-500` | `#66756b` |
| 边框 | `ink-100` | `#e1e7df` |

### Typography

`font-sans` 与 `font-display` 均使用 Segoe UI、Microsoft YaHei、PingFang SC 与系统无衬线字体。无需远程字体或字体包；Windows 字形通过 CDP 实测 Segoe UI / Microsoft YaHei。桌面页面标题 44px、笔记标题 20px；手机分别 29px、16px。

### Layout and components

- 页面使用 `components/AppLayout.tsx`：顶栏在桌面和手机统一提供品牌与设置工具，设置页改为返回笔记库。仅一个内容库时不保留侧栏、重复库导航项或底部导航。正文居中，最大外宽 1344px、桌面左右内距 32px；手机左右 16px。
- 阅读页传 `reader`，手机保留内容操作栏并为它预留底部安全区；普通页面不再为导航预留 100px。HashRouter 内的目录使用 `scrollIntoView`，不要使用会改写路由的 fragment 链接。
- 笔记列表不依赖封面、不在标题前填装饰图标。`lib/note-preview.ts::getNotePreview(note)` 优先 `preview`，回退可读转录；UI 单行省略，保存完整文字。
- 设置按视频转录、AI 笔记生成分两栏，自动产物开关属于 AI 栏；640px 以下垂直排列。
- Summary-template management is a full-width local Settings view, not a new top-level route. Keep its entry/default selector in the AI group; use a bounded 480px desktop library and a labeled mobile editing selector. Editing selection must not change the generation default. Reuse the parent's Save action and ConfirmModal; source built-in text/limits from backend metadata.
- `.panel`、`.input-shell`、三种 `.button-*`、`.icon-button` 是共享样式。旧 `.editorial-*` 仅供现有弹窗复用，外观已统一为白底、绿色边框和圆角。
- `DialogFrame` 管理 Escape、焦点约束、关闭后焦点恢复和背景滚动。阅读标签支持左右方向键、Home / End。
- 后台任务属于笔记库局部区域，使用摘要加原位展开列表，不增加独立导航或模态遮罩。展开期间仍可操作笔记；失败任务也必须有入口。仅扫码、确认和错误使用 DialogFrame。
- Mermaid 保留 strict 安全模式，通过 `cScale*`、`cScaleInv*`、`cScaleLabel*`、`git0` 统一绿色调，SVG 适配容器，缩放后可滚动。

### Responsive Design

```typescript
// Mobile-first responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
```

### Animation Patterns

2026-10-15 交互规范：页面/标签淡入 140–160ms，弹窗进入 220ms、退出 160ms；使用 globals.css 的 motion 变量，避免给后台请求增加人为延时。`prefers-reduced-motion` 同时覆盖 CSS 动画和目录的 JS 平滑滚动。

- `LoadingState` 区分初次读取与真实空内容，`LoadFailure` 提供就地重试。
- `PendingNotice` 展示后台实际状态和已等待时间，保留旧内容；禁止虚构百分比或预计完成时间。
- `DialogFrame(open, busy, initialFocusRef)` 通过 portal 管理进入/退出、栈顶焦点约束和共享滚动锁。不要再为确认/错误弹窗单独维护这些行为。
- 提交/保存/取消/删除/重试必须有同步请求锁与可见等待态；异步失败保留输入或原有产物。
- 危险操作默认聚焦取消，不使用全局 Enter 绕过焦点直接提交。

```typescript
// Transition on hover
className="transition-all duration-300"

// Custom slide-down animation
className="animate-slide-down"

// Safe area padding (mobile/Android)
className="pt-safe-area"
```

---

## Accessibility

### Modal Components

```typescript
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
  aria-describedby="modal-description"
>
  <h3 id="modal-title">{title}</h3>
  <p id="modal-description">{message}</p>
</div>
```

### Keyboard Support

```typescript
// ESC to close, Enter to confirm
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") onCancel();
    else if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
  };
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
}, [open, onCancel, onConfirm]);
```

### Focus Management

```typescript
// Auto-focus cancel button when modal opens
useEffect(() => {
  if (open) {
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => cancelBtnRef.current?.focus());
  }
  return () => { document.body.style.overflow = ""; };
}, [open]);
```

---

## Common Mistakes

### ❌ Don't: Use `React.FC` type

```typescript
// BAD: React.FC adds implicit children prop and other issues
const MyComponent: React.FC<Props> = ({ title }) => {};
```

### ✅ Do: Use function declaration with typed props

```typescript
// GOOD
export default function MyComponent({ title }: Props) {}
```

### ❌ Don't: Forget isMountedRef for async operations

```typescript
// BAD: can set state after unmount
useEffect(() => {
  api.getData().then(data => setData(data));
}, []);
```

### ✅ Do: Check mount status

```typescript
// GOOD
const isMountedRef = useRef(true);
useEffect(() => {
  api.getData().then(data => {
    if (isMountedRef.current) setData(data);
  });
  return () => { isMountedRef.current = false; };
}, []);
```

### ❌ Don't: Use BrowserRouter

```typescript
// BAD: won't work with Tauri's file:// protocol
<BrowserRouter>
```

### ✅ Do: Use HashRouter

```typescript
// GOOD: required for Tauri
<HashRouter>
```

---

## Android ↔ WebView Bridge Pattern

When Android native code needs to send data to the React app (e.g., share intents, notification clicks), use this 3-layer pattern:

### Layer 1: Global Registration (`main.tsx`)

Register `window.__BINOTE_XXX__` functions **before** `ReactDOM.createRoot()`. This ensures the function exists even if Android calls it before React renders.

```typescript
import { receiveXxx } from "./lib/xxx";

window.__BINOTE_XXX__ = receiveXxx;

ReactDOM.createRoot(document.getElementById("root")!).render(...);
```

### Layer 2: Buffer Module (`lib/xxx.ts`)

Module-level state that buffers data when React is not ready, and dispatches to the React handler when it is.

Required exports:
- `receiveXxx(data)` -- called by Android via `evaluateJavascript`
- `registerHandler(handler)` -- called by React Context on mount
- `unregisterHandler()` -- called by React Context on unmount

### Layer 3: React Context (`contexts/XxxContext.tsx`)

Wraps routes inside `App.tsx`, providing `useNavigate` to the handler.

```typescript
export function XxxProvider({ children }) {
  const navigate = useNavigate();
  const handler = useCallback((data) => navigate(...), [navigate]);

  useEffect(() => {
    registerHandler(handler);
    return () => unregisterHandler();
  }, [handler]);

  return <>{children}</>;
}
```

### Current Implementations

| Feature | Global Function | Buffer Module | Context |
|---------|----------------|---------------|---------|
| Share Intent | `__BINOTE_RECEIVE_SHARE__` | `lib/share.ts` | `ShareContext` |
| Notification Click | `__BINOTE_NOTIFICATION_CLICK__` | `lib/notification-nav.ts` | `NotificationNavContext` |

When adding a new Android → WebView feature, follow this same pattern. See the cross-layer guide for the full Rust → Android → WebView data flow.
