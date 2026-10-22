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

**Key principle**: Frontend state is a cache of backend state. Re-fetch backend-owned collections after mutations. Editable Settings drafts are an exception: advance the saved baseline to the submitted snapshot without replacing newer local edits (see the Settings contracts below).

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

## 通知点击与后台完成状态

任务完成时写入的 `.notification_nav_target` 是 Android 通知点击所需的元数据，不是用户的导航请求。前端不得在启动、路由变化、`focus` 或 `visibilitychange` 时读取它并跳转，否则正常导航会被刚完成的任务抢占。

`MainActivity` 仅在收到通知点击 Intent 后读取该文件，通过 `window.__BINOTE_NOTIFICATION_CLICK__` 发送笔记 ID；前端沿用 `notification-nav.ts` 的就绪缓冲和注册处理器。Windows 不写这份 Android 元数据。回归验证必须同时覆盖“未点击通知保持当前路由”和“真实点击事件打开笔记”。

## 配置读取、登录刷新与保存快照

`Settings.loadConfig(refreshLogin = false)` 同时读取 `get_config`、`supports_codex` 和 `get_summary_template_defaults`，成功前不展示可编辑的默认配置，也不允许 `save_config`。读取失败在原位重试。

- `savedConfigRef` 保存服务器基线，`currentConfigRef` 保存当前编辑，`loadRequestRef` 拒绝迟到的读取结果。
- 有未保存编辑时，只更新尚未编辑的 `bilibili_sessdata`、`bilibili_bili_jct`、`bilibili_refresh_token`、`bilibili_dede_user_id`、`bilibili_cookie_ts`；扫码成功或主动退出传 `true`，以新登录结果替换这些字段，保留其他编辑。
- 异步合并必须先同步 `currentConfigRef.current`，再调用 `setConfig`。连续的 Promise 返回可能发生在 React 提交之前，不能假定下一次刷新已经读到最新 React state。
- 保存先同步加锁，再捕获配置快照；完成后基线更新为实际发送的快照。保存中继续编辑时，成功提示不能将后续编辑误标为已保存。

Good：编辑模型 → 扫码刷新账号 → 模型编辑保留，新会话随下次保存；Base：初次读取成功后保存；Bad：读取失败不能保存默认值，迟到读取不能覆盖编辑。对应可执行回归为 `binote/scripts/verify-interactions.cjs` 的配置慢读取、保存中编辑与登录刷新场景。

## Summary Template Draft Contract

Files: `src/pages/Settings.tsx`, `src/components/SummaryTemplateSettings.tsx`, `src/lib/summary-templates.ts`, `src/lib/tauri.ts`.

- Persist `summary_templates: SummaryTemplate[]` and `default_summary_template_id: string | null` through `save_config({ config })`. Null selects the immutable built-in; it is not an item in the persisted array.
- Fetch `get_summary_template_defaults() -> { name, content, limits: { max_templates, max_id_bytes, max_name_chars, max_content_chars } }` with the guarded config load. Never embed another production copy of the built-in prompt or substitute a fallback when metadata fails.
- Parent Settings owns drafts, saved baseline, editing ID and local management view. `SummaryTemplateSettings` receives `templates/defaultId/defaults/editingId/onSelect/onChange/validation`; it does not invoke saves. Navigating within Settings must not remount the draft owner or write the route.
- Editing ID is separate from the default ID. Creation/copy uses the metadata content and focuses the name; neither changes the default.
- Replace arrays and changed entries immutably. A shallow top-level save snapshot is safe **only** while its nested arrays/objects are never mutated. Synchronize the current ref and dirty ref before publishing template edits.
- Confirmation deletes an entry and clears its selected default to null in the same draft. Do not save automatically or touch notes. Show the fallback in the confirmation.
- Native `<select>` may use `""` as a UI-only alias for null. A persisted empty/dangling ID must remain visibly invalid; use a distinct missing option so the user can explicitly select the built-in. Never silently normalize a dangling reference.
- Save is blocked in both button and handler until metadata/config are loaded and validation passes. Failed saves retain inputs and expose an inline retryable notice, with technical detail available through ErrorModal. Completion advances only the submitted baseline, not newer drafts.

Validation uses backend metadata limits. `validateSummaryTemplates(templates, defaultId, limits)` returns `valid/message/selectionError/fields: Map<string, TemplateFieldErrors>`. Use `Array.from(text).length` for Unicode scalar counting and Unicode `White_Space` for Rust-compatible trim checks; JS `trim()` differs for U+0085 and U+FEFF. Do not set UTF-16-based HTML maxlength or trim stored content. IDs are ASCII-only; names are unique after trim, case-sensitive. Backend validation remains authoritative; see [storage contract](../backend/database-guidelines.md).

| Case | Required result / assertion |
| --- | --- |
| Base: legacy empty library / null default | Read-only built-in is visible, no implicit write |
| Good: new/copy, edit, save, reload | Exact submitted text/default retained; editor and default remain independent |
| Good: account refresh with edits / edit during save | New account fields merge; templates stay dirty; submitted snapshot unchanged |
| Bad: blank/duplicate/over-limit field or dangling ID | Visible error, save disabled, no invoke |
| Bad: metadata failure / save rejection | Retry load or save; no invented built-in or discarded draft |
| Delete selected custom template | Cancel focused; Escape restores focus; one save includes removal and null fallback |

Executable regression: `scripts/verify-summary-templates.cjs` (included in `npm run test:ui`), plus existing `verify-interactions.cjs`. Use isolated invoke fixtures and deterministic gates, not real accounts, app data or paid generation. Browser fixture checks do not establish native invoke coverage.

## 局部展开状态与路由

任务列表的展开/收起使用 Dashboard 的本地 useState；不得写查询参数或改变导航选中项，也不得向浏览历史增加记录。路由只代表笔记库、笔记详情、设置等真正页面。离开库后任务继续运行，返回通过后端注册表恢复任务，列表默认收起。

## 任务恢复与新任务互斥

Dashboard 的 `tasksLoaded && !tasksError` 是创建转录及消费分享队列的前置条件；只禁用按钮不够，handleSubmit/startTranscription 也必须检查。恢复失败保留输入与分享队列，成功重试后再按 bvid 去重和消费。

NoteDetail 用 `recoveredNoteId === id` 确认当前笔记任务恢复成功，接管已有总结/导图/转录后才开放生成。读取失败时保留正文、禁用生成并提供重新读取。该条件同时约束按钮和 handleGenerate；切换笔记不能沿用旧页的就绪状态。对应回归 `scripts/verify-task-recovery.cjs`。
