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

Editorial / paper aesthetic — terracotta primary on warm cream paper with ink-toned text. See `binote/tailwind.config.js` for the full scale.

| Role | Tailwind Class | Hex | Usage |
|------|---------------|-----|-------|
| Primary | `primary-500` | `#b75d3e` | Primary buttons, focus rings, brand accents (terracotta) |
| Primary deep | `primary-700` | `#7f3f2d` | Hover/active on primary |
| Primary tint | `primary-100` | `#f2e2d8` | Subtle hover backgrounds, soft chips |
| Canvas | `canvas-50` | `#fbf8f2` | Page background (warm cream) |
| Paper | `paper-50` | `#fffdf8` | Card / panel surfaces |
| Text | `ink-900` | `#1f1b18` | Primary text (warm near-black) |
| Muted text | `ink-500` | `#6d6257` | Secondary text |
| Subtle text | `ink-400` / `ink-300` | — | Captions, dividers, placeholder |
| Sage accent | `sage-500` | `#78806f` | Quiet supporting accent |
| Gold accent | `gold-500` | `#b88a53` | Metric / highlight accent |

### Typography

- Body: `font-sans` → **Manrope** (with PingFang SC / Noto Sans SC fallbacks for CJK)
- Display / headings: `font-display` → **Newsreader** serif (with Source Han Serif / Songti fallbacks) — used in `.title-display` / `.section-display` for editorial-style titles

### Custom Shadows

All shadows are warm-toned (rgba based on burnt-orange ink), not cool grey.

```typescript
// Default card — soft warm drop shadow
className="shadow-soft"   // 0 18px 40px -24px rgba(58, 44, 28, 0.28)

// Elevated panel (hero, modal)
className="shadow-panel"  // 0 24px 60px -34px rgba(59, 44, 25, 0.32)

// Floating element (popover, toast)
className="shadow-float"  // 0 28px 80px -38px rgba(75, 53, 27, 0.38)

// Inner highlight (used on glass surfaces)
className="shadow-inset"  // inset 0 1px 0 rgba(255, 255, 255, 0.72)
```

### Component classes

Reusable styles live as `@layer components` in `binote/src/styles/globals.css`:

- `.hero-panel` / `.editorial-card` / `.editorial-card-muted` — paper surfaces with glass blur + inner highlight
- `.editorial-chip` / `.editorial-kicker` — uppercase tracking-wide labels
- `.title-display` / `.section-display` / `.body-muted` — editorial typography scale
- `.button-primary` / `.button-secondary` / `.button-tertiary` — pill buttons with warm shadow
- `.input-shell` / `.textarea-shell` — large rounded inputs with primary focus ring
- `.divider-soft` — fading horizontal rule

### Responsive Design

```typescript
// Mobile-first responsive grid
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
```

### Animation Patterns

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
