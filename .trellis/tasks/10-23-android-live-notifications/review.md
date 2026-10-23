# Implementation and Verification Review

## Scope
Feature branch `feat/android-live-notifications`, isolated worktree based on `ff4edfa`. Original template work is not part of this feature. No commit, installation, production release, key replacement or version bump.

## Contract review
- Registry -> atomic private snapshot -> native polling service -> task-specific PendingIntent -> buffered frontend navigation traced.
- Existing .task_running RAII lifetime and completion-notification path preserved.
- HIGH-risk emit_progress call sites reviewed: calls occur outside registry mutex guards; stream updates delegate once, avoiding recursive locking. Terminal progress callbacks cannot resurrect finished records.
- Snapshot fields are finite stages and opaque identifiers/counts; raw title/error/URL/transcript never reaches lockscreen state.
- Canonical native sources survive clean Android generation; hooks preserve generated plugin wiring and original release-signing guards.
- Native runtime decisions use SDK checks and public permission/eligibility APIs, never OEM version guesses or system-owned flags.
- API36 test caught the initial non-colorized candidate failing early Android16 eligibility; fixed with public eligibility probing and a conditional legacy candidate.
- Regression caught video-title keywords misclassifying stages; now match emitted phase phrases.
- Extra batch-generation test covers an idle interval falling between polling ticks so previous dismissal does not suppress new work.
- Dismissal, stale snapshot fallback and new batch are exercised in the actual Service with Robolectric; updated test heartbeat uses the same wall clock as the producer, not assumed Robolectric uptime advancement.

## Confirmed automated checks
- Rust `cargo test --lib`: **29 passed** including 6 live-notification tests.
- Node clean-sync/navigation contract: **4 passed**.
- Robolectric API35/36: **7 passed** (real eligibility, parser, independent intents, dismissal, stage/fallback/new batch, service stop).
- `npm run test:ui`: all seven existing UI suites passed against this worktree's Vite server.
- `npm run test:android-signing`: **8 passed**.
- Frontend `tsc && vite build`: passed; existing large-bundle/Browserslist warnings.
- Rust LSP: zero diagnostics on changed Rust files; source-fix action made no changes.
- Final arm64 native Rust build + Gradle APK assembly passed; forced native test rerun passed. The final APK matches the legacy signing certificate. Path, size and SHA-256 are recorded in verification.md.
- Diff whitespace check uses `git -c core.whitespace=cr-at-eol diff --check` because lib.rs already uses CRLF in the base commit.

## Remaining blockers / limits
- Full Android lint: **2 inherited TV-manifest errors**, MissingTvBanner and ImpliedTouchscreenHardware; 42 warnings/1 hint, chiefly existing/generated code and dependency notices. Do not suppress or redesign TV support in this task.
- Worktree GitNexus indexing did not complete. detect-changes was attempted, then explicitly retried with the worktree path; the registry knows only bilinote (the original checkout) and Claude-to-IM. No valid graph-based change-scope result is claimed for this worktree. Source review/diff used instead; rerun indexing + detect-changes before a later commit.
- No configured usable Kotlin/TypeScript LSP was available in the routed diagnostics; Kotlin compiler/Robolectric and tsc provide validation. Install/configure the desired server in pi-lsp.json for LSP coverage.
- No independent review-agent tool was exposed; this is a single-agent contract/code review.
- No ADB device connected. Find X8/ColorOS17 promotion, exact firmware, lockscreen, notification permissions, cold/warm native taps and background/battery behavior remain device acceptance, not automated proof.

## Local tooling issues (not production code)
Maven TLS download failures were resolved using official Maven HTTPS artifacts with published checksums; no TLS verification bypass. Robolectric API36 on a modern JDK required a test-only module export. Windows lacks file-symlink privilege: copy the successfully compiled native .so into generated jniLibs before Gradle assembly rather than changing OS security settings. An interrupted Windows linker PDB was moved to an ignored backup and regenerated. Rust also reported a local incremental-cache access warning while tests still passed.

## Harvest
Promoted durable contracts and pitfalls to `.trellis/spec/backend/android-live-notifications-contract.md` with an index link. Network/cache/process troubleshooting remains task-local, not project policy.
