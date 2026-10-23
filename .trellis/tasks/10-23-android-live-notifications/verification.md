# Verification / Device Handoff

## Current delivery — signed Release preview on v0.6.0
The v0.5.4 debug artifact/results below are historical. The current user-approved branch-only GitHub delivery is recorded in [preview-build.md](./preview-build.md): app commit `76da557`, successful Actions run `39986274722`, verified normal arm64 Release APK **22,037,759 bytes**. It includes v0.6.0 templates. Main/Latest were not changed. GitNexus indexing and pre-commit scope checks now work; all integrated regressions and cloud native/signing gates passed. Find X8 device acceptance remains open.

## Historical MVP checks (before v0.6.0 synchronization)

## Branch and scope
- Branch: `feat/android-live-notifications`
- Worktree: `G:/AndroidAPP/biliGPT-live-notifications`
- Base: `ff4edfa` (v0.5.4); does **not** include the original checkout's uncommitted custom-summary-template work.
- No commit, push, production release, automatic install or signing-key change.

## Results
| Check | Result |
| --- | --- |
| Rust `cargo test --lib` | PASS: 29 tests, including 6 live-notification cases |
| Node sync/navigation tests | PASS: 4 tests |
| Android Robolectric API35/API36 | PASS: 7 tests |
| Frontend typecheck + Vite build | PASS; existing bundle-size/Browserslist warnings |
| Existing UI regression | PASS: all 7 scripts under `npm run test:ui` |
| Signing regression | PASS: 8 tests |
| Rust LSP | PASS: no diagnostics; source-fix action unchanged |
| Android arm64 Rust/Gradle build | PASS: final source rebuilt; Gradle package + forced native test rerun successful |
| Actual APK signing certificate | PASS: final APK matches the legacy 0.4.1 certificate |
| Diff whitespace | PASS with `core.whitespace=cr-at-eol`, preserving existing lib.rs CRLF |
| Full Android lint | NOT GREEN: inherited MissingTvBanner + ImpliedTouchscreenHardware; 42 warnings/1 hint |
| GitNexus detect-changes | BLOCKED: isolated worktree not indexed/registered; did not substitute original checkout's unrelated diff |
| Find X8 / ColorOS17 | NOT RUN: no ADB device connected |

## Artifact
- Final APK: `G:/AndroidAPP/biliGPT-live-notifications/binote/BiNote-live-notifications-debug.apk`
- Type: arm64 debug/test build, v0.5.4; not a production release.
- Size: 184,601,547 bytes (about 176 MiB).
- SHA-256: `617FABA83A46106ABDBF9092838E8C09D87AA1FCB002B9D198AA796C1D11C2F7`
- Final packaging + forced Robolectric rerun + actual certificate verification: 2026-10-23 01:49 local time.
- Package was recreated to remove unused ZIP space from incremental packaging; only the verified final file was copied to the delivery path.

## Local build reproduction
Normal environment:
```text
cd binote
npx tauri android init --ci
node scripts/sync-android.cjs
npx tauri android build --debug --target aarch64 --apk true --aab false --ci
```

This Windows machine lacks file-symlink privilege. The Tauri CLI can finish Rust compilation but fail when linking the .so into jniLibs. After verifying successful Rust compilation, copy that newly built `aarch64-linux-android/debug/libbinote_lib.so` into generated `app/src/main/jniLibs/arm64-v8a/`, sync native sources again, then:
```text
gradlew.bat :app:testArm64DebugUnitTest :app:assembleArm64Debug -x rustBuildArm64Debug "-Pkotlin.incremental=false" --console=plain
```
Do not substitute an old .so or change OS security settings automatically. Verify the final APK through `apksigner verify --verbose --print-certs ... | node scripts/verify-android-signing.cjs`.

## Find X8 acceptance (human/device required)
First record actual Android/API version and full ColorOS build. Back up important notes before installing a test build. Keep the existing app/data; do not uninstall to bypass upgrade issues. A certificate match is necessary, not proof of the installed app's version/data compatibility.

1. Allow BiNote notifications. Check whether the OS offers/promotes ongoing notifications for the app.
2. Share a video, start a real task, then return to Bilibili. Confirm true stage changes rather than fabricated percentages.
3. On Android/API>=36 with promotion enabled, observe whether Fluid Cloud appears. If it does not, confirm ordinary notification fallback and collect the device/API/settings result; do not claim OEM support from JVM tests.
4. Start concurrent/queued work. The notification must retain accurate counts and must not disappear when only one task finishes.
5. Tap while transcription has no saved note (library/task list) and once a note exists (that note). Repeat warm/cold app entry and with completion notifications also present.
6. Test normal completion, failure and cancellation: no stale ongoing notification; existing completion behavior remains intact.
7. Dismiss the live notification, allow more progress, then start a genuinely new batch. The old batch must not repeatedly reappear; the new batch may show.
8. Disable promotion while keeping normal notifications: ordinary fallback. Disable notifications entirely: tasks still run subject to ordinary Android background restrictions.
9. Repeat with screen locked and app backgrounded. Lock screen must not reveal transcript, API error or source URL. Promotion is not a substitute for background permission/keepalive.

## Before a later commit/release
Re-index this worktree and rerun GitNexus detect-changes, review the documented inherited lint findings, perform device acceptance, and follow the existing Android signing contract. User has not requested a commit/release in this run.
