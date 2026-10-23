# Android Live Task Notifications — Execution Plan

## Inputs
- PRD: `prd.md`; design/contract: `info.md`.
- Specs: `.trellis/spec/guides/cross-layer-thinking-guide.md`, `.trellis/spec/backend/quality-guidelines.md`, `.trellis/spec/backend/task-history-contract.md`, `.trellis/spec/backend/android-signing-contract.md`, `.trellis/spec/frontend/component-guidelines.md`.

## Execution Budget
One end-to-end MVP slice in this run: a usable ongoing task notification with promotion/fallback. Each layer is developed red-green before the next layer, then integrated. No extra features or release.

## File Map
- Create `binote/src-tauri/src/live_notification.rs`: safe snapshot, atomic file publisher, Android lifecycle worker, unit tests.
- Modify `binote/src-tauri/src/commands.rs`: persist emitted progress; regression tests.
- Modify `binote/src-tauri/src/lib.rs`: register module and Android publisher during setup.
- Create `binote/android/app/src/main/AndroidManifest.xml`, `java/com/binote/app/{MainActivity,TranscribeService,LiveTaskState,LiveTaskNotification,LiveNotificationDismissReceiver}.kt`: canonical native sources and notification lifecycle.
- Create `binote/android/app/src/test/java/com/binote/app/LiveTaskNotificationTest.kt` and `binote/android/binote.gradle.kts`: executable native tests and build configuration.
- Create `binote/scripts/sync-android.cjs`, `binote/scripts/android-live-notifications.test.cjs`: reproducible source sync and regressions.
- Create `binote/src-tauri/tauri.android.conf.json`; modify `.github/workflows/release.yml` to synchronize on clean Android builds.
- Modify `binote/src/lib/notification-nav.ts`, `binote/src/contexts/NotificationNavContext.tsx`: task-list navigation target using existing buffer.
- Update task artifacts and add `.trellis/spec/backend/android-live-notifications-contract.md` plus index link.

## Slice 1: Real task lifecycle to native ongoing notification
- [x] Write Node tests for clean/repeated Android sync and buffered `@tasks`/note navigation; run `node --test scripts/android-live-notifications.test.cjs` from `binote` and observe missing sync/route implementation failures.
- [x] Implement only canonical source restoration and idempotent sync/hooks needed to run native tests. Preserve generated plugin Gradle wiring and signing.
- [x] Write Rust tests for snapshot selection, privacy-safe stages, batch lifetime, file replacement/removal and terminal-safe progress updates; run `cargo test --lib live_notification` from `binote/src-tauri`, observe missing implementation.
- [x] Implement snapshot worker and progress synchronization; repeat focused tests and `cargo test --lib`.
- [x] Write Robolectric tests for parsing, fallback/promotion, dismissal and intent identity; sync and run `./gradlew.bat :app:testArm64DebugUnitTest -x rustBuildArm64Debug` from `binote/src-tauri/gen/android` and observe expected missing-feature failures.
- [x] Implement native notification lifecycle plus minimal task navigation. Repeat Node and native tests; add cases for any discovered integration gaps before fixing.
- [x] Run `npm run build`, `npm run test:ui`, `npm run test:android-signing`, `cargo test --lib`, Android compilation/lint, configured LSP diagnostics and diff checks. Record unavailable checks exactly.
- [ ] Complete GitNexus detect-changes after worktree indexing (currently unavailable). Manual HIGH-risk/cross-layer scope review, specs and checkpoint are complete. No commit/install/release.

## Risks / Watch Items
User settings/OEM can refuse promotion. Android source is currently ignored and must survive regeneration. Do not transfer original uncommitted templates or touch original checkout. No secrets in logs/fixtures. Build/test dependencies may need network. OEM success requires Find X8 testing.

## Ready to Execute
Start Slice 1, budget 1. Product scope already approved in conversation. No blocking product decisions.
