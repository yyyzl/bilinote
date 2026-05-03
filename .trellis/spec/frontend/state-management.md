# State Management

> How state is managed in this project.

---

## Overview

This project uses a **lightweight state management** approach:
- **React `useState`** for component-local state
- **React Context API** for cross-component shared state
- **Tauri `invoke`** as the source of truth (backend owns data)
- **No external state library** (no Redux, Zustand, Jotai, etc.)

---

## State Categories

### 1. Component-Local State (`useState`)

Used for: UI interactions, form inputs, loading states, error messages

```typescript
// Dashboard.tsx — fine-grained state splitting
const [input, setInput] = useState("");                        // Form input
const [notes, setNotes] = useState<api.Note[]>([]);           // Fetched data
const [loading, setLoading] = useState(false);                 // Loading indicator
const [progress, setProgress] = useState("");                  // Progress message
const [error, setError] = useState("");                        // Error message
const [selectionMode, setSelectionMode] = useState(false);     // UI mode
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());  // Selection tracking
```

**Design principle**: Split state into individual `useState` calls rather than using one large state object. This gives React more precise re-rendering control.

### 2. Context State (Cross-Component Shared State)

Used for: Data that multiple pages/components need to access

```typescript
// contexts/ShareContext.tsx
interface ShareContextType {
  pendingUrl: string | null;          // Shared URL from Android intent
  consumeShare: () => string | null;  // One-time consumption pattern
  isProcessing: boolean;              // Prevents duplicate processing
  setIsProcessing: (v: boolean) => void;
}
```

**Current contexts**:
| Context | Purpose | Provider Location |
|---------|---------|-------------------|
| `ShareContext` | Android share intent URL handling | `App.tsx` (wraps all routes) |
| `NotificationNavContext` | Notification click → navigate to note detail | `App.tsx` (inside ShareProvider) |

### 3. Backend State (Source of Truth)

The Rust backend owns all persistent data. Frontend fetches and displays it:

```typescript
// Read
const config = await api.getConfig();
const notes = await api.getNotes();
const note = await api.getNote(id);

// Write
await api.saveConfig(config);
await api.deleteNote(id);
```

**Key principle**: Frontend state is a cache of backend state. After mutations, always re-fetch to ensure consistency.

```typescript
// After delete, re-fetch the list
await api.deleteNote(id);
await loadNotes();  // Re-fetch from backend
```

### 4. Task State (Ephemeral Backend State)

Background tasks have their own state machine in the backend:

```typescript
const taskInfo = await api.getTaskStatus(taskId);
// taskInfo.status: "running" | "completed" | "failed" | "cancelled"
// taskInfo.progress: Chinese progress message
// taskInfo.note_id: Result note ID (when completed)
// taskInfo.error: Error message (when failed)
```

---

## When to Use Global State

### ✅ Use Context when:
- Data is needed across **multiple routes** (e.g., share intent URL)
- A **cross-cutting concern** spans the app (e.g., theme, auth)

### ❌ Don't use Context when:
- Data is only used in **one page** — use `useState` instead
- Data comes from the **backend** — fetch it directly with `invoke`
- Data can be **passed as props** within a page — prefer prop drilling for 1-2 levels

---

## Server State

### Fetching Pattern

```typescript
const loadData = useCallback(async () => {
  try {
    const result = await api.getDataFromBackend();
    if (isMountedRef.current) setData(result);
  } catch (e) {
    if (isMountedRef.current) setError(formatError(e));
  }
}, []);

useEffect(() => {
  loadData();
}, [loadData]);
```

### Mutation + Re-fetch Pattern

```typescript
const handleSave = async () => {
  setLoading(true);
  try {
    await api.saveToBackend(data);
    await loadData();  // Re-fetch to ensure consistency
    // Show success feedback
  } catch (e) {
    setError(formatError(e));
  } finally {
    setLoading(false);
  }
};
```

### Long-Running Task Pattern

```typescript
// 1. Start task → get task ID
const taskId = await api.startTranscribe(bvid);

// 2. Poll for status
const poll = setInterval(async () => {
  const info = await api.getTaskStatus(taskId);
  setProgress(info.progress);
  if (info.status === "completed" || info.status === "failed") {
    clearInterval(poll);
    // Handle result
  }
}, 2000);
```

---

## State Initialization

### From Backend (Config)

```typescript
// Settings.tsx — load existing config on mount
useEffect(() => {
  api.getConfig().then(config => {
    if (isMountedRef.current) {
      setAsrProvider(config.asr_provider || "dashscope");
      setAsrApiKey(config.asr_api_key || "");
      // ... more fields
    }
  });
}, []);
```

### From URL Params

```typescript
// NoteDetail.tsx
const { id } = useParams<{ id: string }>();

useEffect(() => {
  if (id) {
    api.getNote(id).then(note => {
      if (isMountedRef.current) setNote(note);
    });
  }
}, [id]);
```

### From Context (Share Intent)

```typescript
// Dashboard.tsx — consume shared URL
const { pendingUrl, consumeShare } = useShare();

useEffect(() => {
  if (pendingUrl && !loading) {
    const url = consumeShare();
    if (url) startTranscription(url);
  }
}, [pendingUrl, loading]);
```

---

## Common Mistakes

### ❌ Don't: Store derived state

```typescript
// BAD: noteCount can be derived from notes.length
const [notes, setNotes] = useState([]);
const [noteCount, setNoteCount] = useState(0);  // Redundant!
```

### ✅ Do: Compute derived values inline

```typescript
const noteCount = notes.length;  // Derived, not stored
```

### ❌ Don't: Forget to re-fetch after mutations

```typescript
// BAD: UI shows stale data
await api.deleteNote(id);
// Missing: await loadNotes();
```

### ❌ Don't: Use Context for frequently changing values

Context re-renders all consumers on every change. Don't put fast-changing values (like input text or scroll position) in Context.

### ❌ Don't: Mix state concerns in one useState

```typescript
// BAD: one giant state object
const [state, setState] = useState({
  input: "", notes: [], loading: false, error: "", selected: new Set()
});
```

### ✅ Do: Split state by concern

```typescript
// GOOD: each concern is independent
const [input, setInput] = useState("");
const [notes, setNotes] = useState([]);
const [loading, setLoading] = useState(false);
```
