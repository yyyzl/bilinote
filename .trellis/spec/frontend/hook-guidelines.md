# Hook Guidelines

> How hooks are used in this project.

---

## Overview

This project uses:
- **React built-in hooks** — `useState`, `useEffect`, `useRef`, `useCallback`, `useContext`
- **Custom hooks** — Context accessor hooks (e.g., `useShare`)
- **No data fetching library** — Direct Tauri `invoke` calls (not React Query, SWR, etc.)

---

## Custom Hook Patterns

### Context Accessor Hook

The primary custom hook pattern in this project wraps `useContext` with a guard:

```typescript
// contexts/ShareContext.tsx
export function useShare(): ShareContextType {
  const context = useContext(ShareContext);
  if (!context) {
    throw new Error('useShare must be used within ShareProvider');
  }
  return context;
}
```

**Key rules**:
1. Always validate context is not null/undefined
2. Throw descriptive error message including the required Provider
3. Return typed context value

### Usage

```typescript
// In a page component
const { pendingUrl, consumeShare, isProcessing } = useShare();
```

---

## Data Fetching

### Pattern 1: Direct Invoke (Simple Reads)

For one-time data loading, use direct `invoke` in `useEffect`:

```typescript
const [notes, setNotes] = useState<api.Note[]>([]);
const isMountedRef = useRef(true);

const loadNotes = useCallback(async () => {
  try {
    const data = await api.getNotes();
    if (isMountedRef.current) setNotes(data);
  } catch (e) {
    console.error(e);
  }
}, []);

useEffect(() => {
  isMountedRef.current = true;
  loadNotes();
  return () => { isMountedRef.current = false; };
}, [loadNotes]);
```

### Pattern 2: Polling (Long-Running Tasks)

For background tasks, use `setInterval` polling:

```typescript
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

const startPolling = useCallback((taskId: string) => {
  pollRef.current = setInterval(async () => {
    if (!isMountedRef.current) {
      clearInterval(pollRef.current!);
      return;
    }

    try {
      const taskInfo = await api.getTaskStatus(taskId);
      setProgress(taskInfo.progress);

      if (taskInfo.status === "completed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        // Fetch final result
        const updated = await api.getNote(taskInfo.note_id!);
        setNote(updated);
      } else if (taskInfo.status === "failed") {
        clearInterval(pollRef.current!);
        pollRef.current = null;
        setError(taskInfo.error || "Unknown error");
      }
    } catch (e) {
      clearInterval(pollRef.current!);
      setError(formatError(e));
    }
  }, 2000);  // 2-second interval
}, []);
```

**Key rules for polling**:
- Always check `isMountedRef.current` before state updates
- Always clear interval on completion, failure, or unmount
- Use `useRef` for interval ID (not state)

### Pattern 2.5: Serialized Polling for Slow Requests

If one poll request can take longer than the polling interval, do **not** use `setInterval(async ...)`.
Use recursive `setTimeout` plus a session/request guard so old responses cannot overwrite new state.

```typescript
const pollSessionRef = useRef(0);
const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const stopPolling = useCallback(() => {
  pollSessionRef.current += 1;
  if (pollTimeoutRef.current) {
    clearTimeout(pollTimeoutRef.current);
    pollTimeoutRef.current = null;
  }
}, []);

const pollOnce = useCallback(async (taskId: string, sessionId: number) => {
  if (!isMountedRef.current || pollSessionRef.current !== sessionId) return;

  const result = await api.getTaskStatus(taskId);
  if (!isMountedRef.current || pollSessionRef.current !== sessionId) return;

  pollTimeoutRef.current = setTimeout(() => {
    void pollOnce(taskId, sessionId);
  }, 2000);
}, []);
```

Use this pattern for QR login, remote auth, or any endpoint whose latency can exceed the timer interval.

### Pattern 3: Event Listeners (Real-time Updates)

For Tauri event streams, use `listen` with cleanup:

```typescript
useEffect(() => {
  let cleanup: (() => void) | undefined;

  api.onProgress((msg) => {
    if (isMountedRef.current) setProgress(msg);
  }).then(fn => { cleanup = fn; });

  return () => { cleanup?.(); };
}, []);
```

---

## Naming Conventions

| Pattern | Convention | Example |
|---------|-----------|---------|
| Custom hooks | `use*` prefix | `useShare` |
| Data loaders | `load*` | `loadNotes`, `loadConfig` |
| Event handlers | `handle*` | `handleSubmit`, `handleDelete` |
| Callbacks passed as props | `on*` | `onClose`, `onConfirm` |
| Refs | `*Ref` suffix | `isMountedRef`, `pollRef`, `cancelBtnRef` |
| State setters | `set*` | `setNotes`, `setLoading`, `setError` |

---

## Memory Leak Prevention

### Required Pattern: isMountedRef

Every page component that does async operations MUST use this pattern:

```typescript
const isMountedRef = useRef(true);

useEffect(() => {
  isMountedRef.current = true;
  // ... async operations

  return () => {
    isMountedRef.current = false;
  };
}, []);

// In every async callback:
if (isMountedRef.current) setData(result);
```

### Required Pattern: Timer Cleanup

```typescript
const clearAllTimers = useCallback(() => {
  if (pollIntervalRef.current) {
    clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = null;
  }
  if (successTimeoutRef.current) {
    clearTimeout(successTimeoutRef.current);
    successTimeoutRef.current = null;
  }
}, []);

useEffect(() => {
  return () => {
    isMountedRef.current = false;
    cleanup?.();        // Event listeners
    clearAllTimers();   // Intervals and timeouts
  };
}, [clearAllTimers]);
```

### Required Pattern: Event Listener Cleanup

```typescript
// Tauri events
api.onProgress(callback).then(fn => { cleanup = fn; });
// cleanup() calls unlisten functions

// DOM events
window.addEventListener("keydown", handler);
return () => window.removeEventListener("keydown", handler);
```

---

## Common Mistakes

### ❌ Don't: Forget cleanup in useEffect

```typescript
// BAD: memory leak — interval runs after unmount
useEffect(() => {
  const id = setInterval(() => fetchData(), 2000);
  // Missing: return () => clearInterval(id);
}, []);
```

### ❌ Don't: Set state without mount check in async callbacks

```typescript
// BAD: can cause "Can't perform a React state update on an unmounted component"
api.onProgress((msg) => {
  setProgress(msg);  // Component may be unmounted!
});
```

### ❌ Don't: Use state for interval/timeout IDs

```typescript
// BAD: useState causes re-render, ref doesn't
const [intervalId, setIntervalId] = useState<number | null>(null);
```

### ✅ Do: Use useRef for mutable values that don't need re-render

```typescript
// GOOD
const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
```

### ❌ Don't: Use `setInterval(async ...)` for network polling without overlap protection

```typescript
// BAD: a slow request can overlap with the next tick
setInterval(async () => {
  await api.getTaskStatus(taskId);
}, 2000);
```

This can create concurrent requests and stale responses that overwrite the newest UI state.

### ❌ Don't: Create inline async functions in useEffect

```typescript
// BAD: useEffect can't return a Promise
useEffect(async () => {  // This is wrong!
  await loadData();
}, []);
```

### ✅ Do: Define async function inside or use IIFE

```typescript
// GOOD
useEffect(() => {
  loadData();  // loadData is a useCallback
}, [loadData]);
```
