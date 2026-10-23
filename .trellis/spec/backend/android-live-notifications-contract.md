# Android Live Task Notification Contract

## Scope and ownership
- User-started transcription, summary and mindmap tasks only. No permanent chat launcher.
- Promotion is an OS/OEM/user decision, not a guarantee that processing qualifies for Fluid Cloud.
- Rust: `binote/src-tauri/src/live_notification.rs`; `commands::emit_progress` persists progress before emitting the unchanged `{ task_id, message }` event.
- Android source of truth: `binote/android/`, not ignored `src-tauri/gen/android/`.
- Frontend: `binote/src/lib/notification-nav.ts` and `NotificationNavContext.tsx`.
- Existing completion notifications and reference-counted `.task_running` service lifetime remain independent.

## Producer and consumer
`live_notification::start(AppHandle)` runs only on Android after AppState registration. It observes the registry and atomically replaces `data_dir/.live_task_state.json` once per second through a same-directory temporary file. It releases the registry mutex before serialization/I/O. Terminal records are excluded. Errors are logged, not propagated to ASR/LLM work.

The foreground service reads `File(filesDir.parentFile, LiveTaskState.FILENAME)` every two seconds, even without a visible WebView. No per-token notification updates: heartbeat-only differences do not call notify again. The last task flag disappearing stops foreground display and releases existing keepalive locks; stale snapshots alone do not stop an active task.

`TaskFlagGuard` creates its flag at 0→1 active tasks. The publisher observes the flag's modification timestamp, so a new batch is recognized even if its preceding idle interval is shorter than a snapshot tick. A session UUID otherwise persists across selected-task changes. Missing metadata must not reset a batch. Idle/startup/global-cancel cleanup removes snapshot/temp files.

## Snapshot v1
```json
{
  "version": 1,
  "session_id": "batch-uuid",
  "task_id": "task-uuid",
  "note_id": "note-uuid",
  "stage": "transcribing",
  "active_count": 2,
  "queued_count": 1,
  "updated_at": 1792680000
}
```

| Field | Validation |
| --- | --- |
| version | Integer exactly 1, not a numeric string |
| session_id, task_id | ASCII `[A-Za-z0-9_-]{1,64}` |
| note_id | Same identifier rule, or null/absent |
| stage | queued, fetching, subtitles, downloading, transcribing, summary, mindmap, summary_mindmap, retrying, saving, processing |
| active_count | Integer 1..10000, includes queued work |
| queued_count | Integer 0..active_count |
| updated_at | Nonnegative integer Unix seconds; at most 10 seconds old / 5 seconds ahead |

Read at most 8192 bytes. Choose the oldest running task before queued tasks, with created_at then task_id ordering. Unknown progress maps to processing. Match emitted phase phrases, not broad keywords in arbitrary video titles. Never serialize titles, transcripts, source URLs, errors, keys, percentages or ETA.

## Native notifications and compatibility
- Standard `Notification.Builder`, nonempty title, ongoing, only-alert-once, PRIVATE visibility, stable notification ID 1001 and existing LOW-importance `binote_transcribe_channel`.
- Preserve user channel preferences; never manufacture a new channel to bypass a user's choice.
- Declare `POST_NOTIFICATIONS`, `POST_PROMOTED_NOTIFICATIONS` and existing foreground-service permissions.
- Only API>=36, allowed `NotificationManager.canPostPromotedNotifications()`, fresh running state, and a non-dismissed batch may request promotion.
- Use documented `android.requestPromotedOngoing=true` extra and `setShortCriticalText` (compile SDK36 lacks the newer Builder setter).
- Build standard/non-colorized first and ask public `hasPromotableCharacteristics()`. Early API36 requires colorization while later revisions do not; use a legacy colorized candidate only if its public eligibility check succeeds. Do not set system-owned promotion flags, invoke hidden APIs or guess from ColorOS versions.
- Queued-only, invalid/stale, older-version or denied-promotion cases retain an ordinary ongoing notification. System-wide notification denial may hide it entirely; do not treat that as task failure.
- `LiveNotificationDismissReceiver` is explicit/non-exported. Persist the dismissed session in private preferences and suppress polling updates for that session; a new batch may show. Dismissal never cancels work. An actual service recreation may require a normal foreground notification but must not re-request dismissed promotion.

## Tap contract
`ACTION_OPEN = com.binote.app.action.OPEN_LIVE_TASK`; immutable PendingIntent with task-specific `binote://live-task/<task_id>` identity and `live_note_id` extra.

`MainActivity.handleNotificationClickIntent` consumes that action separately from completion notifications. Validate identifiers, quote JavaScript with JSONObject, and use the existing retry/cold-start buffer. Never read or overwrite a completion notification's shared navigation file for a live tap.

`notificationRoute(target: string): string | null`:
- Valid note ID → `/note/<id>`.
- Reserved `@tasks` → `/` (task list lives in the library).
- Invalid target → null; native missing/invalid note → `@tasks`.

## Good / Base / Bad cases
| Case | Expected |
| --- | --- |
| Running transcription + queued summary | One aggregate notification, real selected stage, correct counts and task-specific target |
| Same heartbeat / streamed character count | No redundant native notification update |
| One queued task / API35 / promotion disabled | Ordinary ongoing notification |
| Invalid JSON, wrong version, stale/future state | Generic ordinary notification, task continues |
| User removes notification | No repeat polling display for that batch; new batch may display |
| Last task completes/fails/cancels | Snapshot removed, foreground notification removed, existing completion path retained |
| Process restarts | Startup clears stale files; no ghost ongoing service |
| Notification or snapshot I/O rejected | No ASR/LLM command error; ordinary/system-limited fallback |

## Reproducible builds and checks
Initialize with `npx tauri android init --ci`; `node scripts/sync-android.cjs` restores canonical native sources and applies `android/binote.gradle.kts` exactly once. Android-specific Tauri hooks and release CI invoke it. Do not overwrite Tauri's generated plugin wiring, track generated projects, or change signing keys.

From `binote/`:
- `node --test scripts/android-live-notifications.test.cjs`: clean/idempotent sync, hooks and safe buffered navigation.
- `npm run build`, `npm run test:ui` (requires local Vite server), `npm run test:android-signing`.

From `binote/src-tauri/`: `cargo test --lib`.

After a full Tauri Android build generates native scaffolding, from `src-tauri/gen/android/`:
- `./gradlew :app:testArm64DebugUnitTest -x rustBuildArm64Debug`: API35/36, parser, taps, dismissal, real service phase changes/fallback/cleanup.
- `./gradlew :app:lintArm64Debug -x rustBuildArm64Debug`; distinguish inherited manifest/generated-code warnings from feature regressions, never hide failures.
- JVM tests use Robolectric 4.17. Its Android 16/API36 sandbox requires **JDK 21** (DefaultSdkProvider rejects Java17 before tests execute); local and GitHub Android jobs must supply Java21. Also export `java.base/jdk.internal.access` for the API36 FileDescriptor interceptor. The Node contract test guards the CI Java version and native test command.

Device acceptance remains mandatory: record Android API + firmware; verify notification permission/promotion denied, visible/locked/background states, concurrent work, dismissal/new batch, completion/failure/cancel cleanup, warm/cold taps and battery behavior. A passing JVM eligibility assertion does not prove OPPO promotion. Any upgrade test must follow [Android Signing](./android-signing-contract.md); never uninstall user data to work around a certificate mismatch.
