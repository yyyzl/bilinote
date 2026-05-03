# Type Safety

> Type safety patterns in this project.

---

## Overview

This project uses **TypeScript** in **strict mode** with comprehensive type checking:

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

Key principles:
- **No `any`** — the codebase has zero `any` usage
- **Interface for props** — all component props use `interface`
- **Type alias for unions** — literal union types use `type`
- **Centralized type definitions** — all business types in `lib/tauri.ts`

---

## Type Organization

### Centralized Business Types (`lib/tauri.ts`)

All types that mirror the Rust backend are defined in a single file:

```typescript
// lib/tauri.ts — Single source of truth for backend types

export interface Note {
  id: string;
  bvid: string;
  title: string;
  cover: string;
  transcript: string;
  summary: string | null;      // null = not yet generated
  mindmap: string | null;      // null = not yet generated
  created_at: number;          // Unix timestamp
}

export interface AppConfig {
  asr_provider: AsrProvider;
  asr_api_key: string | null;
  sensevoice_api_key: string | null;
  llm_api_key: string | null;
  llm_base_url: string | null;
  llm_model: string | null;
}

export interface TaskInfo {
  status: string;              // "running" | "completed" | "failed" | "cancelled"
  progress: string;
  note_id: string | null;
  error: string | null;
}

export type AsrProvider = "dashscope" | "sensevoice";
```

### Component-Local Types (in component files)

Props interfaces and local types are defined at the top of their component file:

```typescript
// components/ErrorModal.tsx
interface ErrorModalProps {
  error: string | null;
  onClose: () => void;
}

// pages/NoteDetail.tsx
type TabType = "summary" | "mindmap";
type GenerateType = "summary" | "mindmap";
```

### Context Types

```typescript
// contexts/ShareContext.tsx
interface ShareContextType {
  pendingUrl: string | null;
  consumeShare: () => string | null;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
}
```

---

## Type Patterns

### Typed Tauri Invoke

All Tauri commands are wrapped with explicit return types:

```typescript
export const getConfig = () => invoke<AppConfig>("get_config");
export const getNotes = () => invoke<Note[]>("get_notes");
export const getNote = (id: string) => invoke<Note>("get_note", { id });
export const startTranscribe = (bvid: string) => invoke<string>("start_transcribe", { bvid });
export const getTaskStatus = (taskId: string) => invoke<TaskInfo>("get_task_status", { taskId });
```

### Literal Union Types

```typescript
// Use 'type' for string literal unions (not enum)
type AsrProvider = "dashscope" | "sensevoice";
type TabType = "summary" | "mindmap";
type GenerateType = "summary" | "mindmap";

// ✅ GOOD: type-safe at call sites
const [activeTab, setActiveTab] = useState<TabType>("summary");
```

### Generic State Typing

```typescript
const [notes, setNotes] = useState<api.Note[]>([]);
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
```

### Config Object as `const`

```typescript
const GENERATE_CONFIG = {
  summary: {
    startApi: api.startSummarize,
    eventKey: "summarize",
    successField: "summary" as const,
  },
  mindmap: {
    startApi: api.startMindmap,
    eventKey: "mindmap",
    successField: "mindmap" as const,
  },
} as const;
```

### Event Handler Types

```typescript
const handleCardClick = (e: React.MouseEvent, noteId: string) => {};
const handleTouchStart = (e: React.TouchEvent, noteId: string) => {};
const handleKeyDown = (e: KeyboardEvent) => {};
```

### Ref Types

```typescript
const isMountedRef = useRef(true);                               // useRef<boolean>
const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);  // Timer ref
const cancelBtnRef = useRef<HTMLButtonElement>(null);             // DOM ref
```

---

## Null vs Undefined

This project uses a clear distinction:

| Value | Meaning | Usage |
|-------|---------|-------|
| `null` | Explicitly absent | Backend fields (`summary: string \| null`) |
| `undefined` | Not provided | Optional props (`isDisabled?: boolean`) |
| `""` | Empty string | Form inputs, cleared errors |

```typescript
// Backend types use null
interface Note {
  summary: string | null;   // null = not yet generated
}

// UI state uses "" for "no error"
const [error, setError] = useState("");  // "" = no error
setError("");  // Clear error

// Optional props use ?
interface Props {
  title?: string;  // undefined if not passed
}
```

---

## Validation

### Runtime Type Checking

Currently, there is **no runtime validation library** (no Zod, Yup, etc.). The Tauri invoke layer trusts the Rust backend to return correctly typed data.

**Error formatting** serves as the validation catch-all:

```typescript
export function formatError(e: unknown): string {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  if (e instanceof Error) return `${e.name}: ${e.message}\n${e.stack || ""}`;
  try {
    return JSON.stringify(e, null, 2);
  } catch {
    return String(e);
  }
}
```

---

## Forbidden Patterns

### ❌ Never use `any`

```typescript
// BAD
const data: any = await invoke("get_data");
```

### ✅ Use proper types or `unknown`

```typescript
// GOOD
const data = await invoke<Note[]>("get_notes");

// If truly unknown, use 'unknown' and narrow
function formatError(e: unknown): string {
  if (typeof e === "string") return e;
  // ...
}
```

### ❌ Don't use type assertions (`as`) unnecessarily

```typescript
// BAD: bypasses type checking
const note = data as Note;
```

### ✅ Use typed generics

```typescript
// GOOD: invoke<Note> provides type safety
const note = await invoke<Note>("get_note", { id });
```

### ❌ Don't use `enum` for simple string unions

```typescript
// BAD: generates runtime code
enum AsrProvider { DashScope = "dashscope", SenseVoice = "sensevoice" }
```

### ✅ Use `type` with string literals

```typescript
// GOOD: zero runtime cost
type AsrProvider = "dashscope" | "sensevoice";
```
