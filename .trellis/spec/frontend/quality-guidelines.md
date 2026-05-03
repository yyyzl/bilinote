# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

The frontend enforces quality through:
- **TypeScript strict mode** — compile-time type safety
- **Tailwind CSS** — consistent styling patterns
- **Memory leak prevention** — systematic cleanup in every component
- **Accessibility** — ARIA attributes and keyboard support in interactive components

---

## Forbidden Patterns

### ❌ `any` type

Never use `any`. Use `unknown` if the type is truly unknown, then narrow with type guards.

### ❌ `BrowserRouter`

```typescript
// BAD: won't work with Tauri's file:// protocol
<BrowserRouter>
```

Always use `HashRouter`.

### ❌ `React.FC` for component typing

```typescript
// BAD: adds implicit children, causes issues with generics
const Component: React.FC<Props> = () => {};
```

### ❌ Inline styles (except dynamic values)

```typescript
// BAD: use Tailwind instead
<div style={{ backgroundColor: 'pink', padding: '16px' }}>
```

**Exception**: Dynamic values that can't be expressed with Tailwind:
```typescript
// OK: dynamic value
<div style={{ paddingTop: `var(--safe-area-top)` }}>
```

### ❌ `console.log` in production code

```typescript
// BAD: left-over debug log
console.log("data:", data);
```

`console.error` is acceptable for error logging in catch blocks.

### ❌ Async functions in useEffect

```typescript
// BAD: useEffect callback cannot be async
useEffect(async () => {
  const data = await fetchData();
}, []);
```

### ❌ Setting state after unmount

```typescript
// BAD: no mount check
api.getData().then(data => setData(data));
```

### ❌ Missing cleanup in useEffect

Every `useEffect` that sets up subscriptions, intervals, or event listeners MUST return a cleanup function.

---

## Required Patterns

### ✅ Mount check for async state updates

```typescript
const isMountedRef = useRef(true);
useEffect(() => {
  isMountedRef.current = true;
  return () => { isMountedRef.current = false; };
}, []);
```

### ✅ Typed Tauri invoke wrappers

```typescript
// All invocations wrapped with types in lib/tauri.ts
export const getNote = (id: string) => invoke<Note>("get_note", { id });
```

### ✅ Error boundary pattern

All user-facing errors should flow through `formatError()` and display via `ErrorModal`:

```typescript
try {
  await someOperation();
} catch (e) {
  setError(formatError(e));
}
// Then in JSX:
<ErrorModal error={error} onClose={() => setError("")} />
```

### ✅ Event listener cleanup

```typescript
useEffect(() => {
  let cleanup: (() => void) | undefined;
  api.onProgress(callback).then(fn => { cleanup = fn; });
  return () => { cleanup?.(); };
}, []);
```

### ✅ useCallback for functions passed as props or in dependency arrays

```typescript
const loadNotes = useCallback(async () => {
  // ...
}, []);

useEffect(() => {
  loadNotes();
}, [loadNotes]);
```

### ✅ Tailwind for all styling

Use Tailwind utility classes. Define custom utilities in `globals.css` only for:
- CSS custom properties (safe area)
- Keyframe animations
- Complex pseudo-element styles

### ✅ Lucide React for icons

```typescript
import { ArrowLeft, Trash2, Share2 } from "lucide-react";
<ArrowLeft size={20} />
```

---

## Testing Requirements

**Current state**: No frontend tests exist.

**Recommended minimum**:
- Component tests for `ErrorModal`, `ConfirmModal` (render, interaction)
- Integration tests for `lib/tauri.ts` mock invoke
- E2E tests for critical flows (add note, view note, settings)

---

## Code Review Checklist

When reviewing frontend changes:

- [ ] No `any` types anywhere
- [ ] Components use `export default function` pattern
- [ ] Props are typed with `interface`
- [ ] `isMountedRef` check for all async state updates
- [ ] All `useEffect` have proper cleanup
- [ ] Intervals/timeouts use `useRef` (not state)
- [ ] New Tauri commands have typed wrappers in `lib/tauri.ts`
- [ ] Styling uses Tailwind classes (no inline styles)
- [ ] Error handling uses `formatError()` + `ErrorModal`
- [ ] New routes use `HashRouter` paths
- [ ] Modals have ARIA attributes (`role`, `aria-modal`, `aria-labelledby`)
- [ ] Interactive elements have keyboard support (Escape, Enter)
- [ ] Mobile touch interactions handle long-press correctly
- [ ] Event listeners are cleaned up in useEffect return

---

## Build & Development

### Commands

```bash
cd binote
npm run dev      # Development server (port 5173, hot reload)
npm run build    # Production build (to dist/)
npm run tauri dev    # Full Tauri dev (frontend + Rust backend)
npm run tauri build  # Production build (desktop + Android)
```

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `react` 18.3 | UI framework |
| `react-router-dom` 7.x | Client-side routing (HashRouter) |
| `@tauri-apps/api` 2.x | Tauri invoke and event APIs |
| `@tauri-apps/plugin-*` 2.x | Tauri plugins (notification, shell) |
| `lucide-react` | Icon library |
| `mermaid` | Diagram rendering |
| `react-markdown` + `remark-gfm` | Markdown rendering |
| `tailwindcss` | Utility-first CSS |
| `typescript` 5.5 | Type safety |
| `vite` 6.x | Build tool |
