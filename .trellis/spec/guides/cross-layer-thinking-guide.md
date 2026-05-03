# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers.

Common cross-layer bugs:
- API returns format A, frontend expects format B
- Database stores X, service transforms to Y, but loses data
- Multiple layers implement the same logic differently

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

Draw out how data moves:

```
Source → Transform → Store → Retrieve → Transform → Display
```

For each arrow, ask:
- What format is the data in?
- What could go wrong?
- Who is responsible for validation?

### Step 2: Identify Boundaries

| Boundary | Common Issues |
|----------|---------------|
| API ↔ Service | Type mismatches, missing fields |
| Service ↔ Database | Format conversions, null handling |
| Backend ↔ Frontend | Serialization, date formats |
| Component ↔ Component | Props shape changes |
| Rust ↔ Android (Kotlin) | Plugin APIs may silently drop data; file-based channel is the proven fallback |
| Android ↔ WebView | WebView may not be ready; requires buffer + retry pattern |

### Step 3: Define Contracts

For each boundary:
- What is the exact input format?
- What is the exact output format?
- What errors can occur?

---

## Common Cross-Layer Mistakes

### Mistake 1: Implicit Format Assumptions

**Bad**: Assuming date format without checking

**Good**: Explicit format conversion at boundaries

### Mistake 2: Scattered Validation

**Bad**: Validating the same thing in multiple layers

**Good**: Validate once at the entry point

### Mistake 3: Leaky Abstractions

**Bad**: Component knows about database schema

**Good**: Each layer only knows its neighbors

---

## Checklist for Cross-Layer Features

Before implementation:
- [ ] Mapped the complete data flow
- [ ] Identified all layer boundaries
- [ ] Defined format at each boundary
- [ ] Decided where validation happens

After implementation:
- [ ] Tested with edge cases (null, empty, invalid)
- [ ] Verified error handling at each boundary
- [ ] Checked data survives round-trip

---

## Tauri v2 Plugin Gotchas

### Notification Plugin: `extra` Data Lost on Immediate Notifications

**Severity**: Critical -- will silently fail with no error.

Tauri notification plugin v2 (tested: 2.3.3) has a bug where **immediate notifications** (i.e. `builder.show()`) produce `Notification.sourceJson = null` internally. This means:

1. `.extra("key", "value")` is set correctly when building the notification
2. Android creates the PendingIntent with the notification JSON
3. But `sourceJson` is null, so the serialized JSON in the Intent is `{"source":null, ...}`
4. When the user clicks the notification, `handleNotificationActionPerformed()` extracts the JSON but `extra` is empty
5. The `onAction()` / `actionPerformed` event arrives in the frontend with `notification: null`

**Result**: The entire `onAction()` API is useless for immediate notifications. The `extra` data never reaches the frontend.

**Workaround**: Use the file-based cross-layer communication pattern (see below). Rust writes data to a file before showing the notification; Android reads the file on notification click.

**Do not**:
- Trust the plugin's `onAction()` API for passing data through notifications
- Trust `info.md` / design docs that claim "plugin already handles this" without verifying with a real device test
- Spend time debugging `addPluginListener` type mismatches -- the TS types for `onAction` are also inaccurate (`Options` vs actual `{ actionId, notification, inputValue }` shape), but this is moot since the entire mechanism is broken

---

## File-Based Cross-Layer Communication (Rust ↔ Android)

When Rust needs to pass data to Android native code (Kotlin), use a **file-based channel**. This pattern is used by both the share feature and notification click navigation.

### Pattern

```
Rust: write data to file (app data dir)
  → Android event triggers (notification click / share intent)
  → Kotlin: read-and-delete file to get data
  → Kotlin: evaluateJavascript() to call WebView global function
  → JS module: buffer or dispatch to React handler
```

### Implementation Checklist

1. **Rust side** (`notification.rs` / similar):
   - Define a constant filename (e.g., `NAV_TARGET_FILENAME = ".notification_nav_target"`)
   - Write data to `app.path().data_dir().join(filename)` **before** the triggering action (e.g., before `builder.show()`)
   - Use `std::fs::write()` -- file is small, blocking is acceptable

2. **Android side** (`MainActivity.kt`):
   - Use the same filename constant
   - Read file with `filesDir.parentFile` (= Tauri app data dir)
   - **Delete file immediately** after reading to prevent stale data
   - Buffer the data if WebView is not yet created (`pendingXxx` field)
   - Send to WebView via `evaluateJavascript()` with retry mechanism

3. **Frontend side** (3-layer bridge):
   - `main.tsx`: Register `window.__BINOTE_XXX__` global function **before** React renders
   - `lib/xxx.ts`: Buffer module with `pendingXxx`, `handler`, `isReactReady` state
   - `contexts/XxxContext.tsx`: React Context that calls `registerHandler()` in `useEffect`, providing `useNavigate`

### Key Constraints

- File must be written **before** the notification is shown (race condition prevention)
- File must be **read-and-deleted** atomically (prevent processing stale data)
- WebView global function must be registered **before** `ReactDOM.createRoot()` (catch early intents)
- Buffer module must handle the "React not ready yet" case (cold start from notification click)
- Retry mechanism in Kotlin: check if JS function exists, retry with delay (500ms intervals, 20 max attempts = 10s window)

### Reference Files

| Layer | File | Role |
|-------|------|------|
| Rust | `src-tauri/src/notification.rs` | Write nav target file |
| Android | `src-tauri/gen/android/.../MainActivity.kt` | Read file, inject JS |
| JS module | `src/lib/notification-nav.ts` | Buffer + handler registration |
| React Context | `src/contexts/NotificationNavContext.tsx` | Navigate on notification click |
| JS module (share) | `src/lib/share.ts` | Same pattern for share intent |
| React Context (share) | `src/contexts/ShareContext.tsx` | Same pattern for share intent |

---

## When to Create Flow Documentation

Create detailed flow docs when:
- Feature spans 3+ layers
- Multiple teams are involved
- Data format is complex
- Feature has caused bugs before
