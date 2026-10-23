# Branch-only signed Android preview

## User approval
User explicitly requested uploading this work to GitHub and producing a normal APK for Android testing, without merging into master/main. This supersedes the earlier no-commit restriction for this task only.

## Delivery plan
- Branch: `feat/android-live-notifications`; synchronized to v0.6.0 `62837d4` so existing summary-template features/data are retained.
- Commit/push only that branch. No force-push, main changes, tag creation, published release or Latest changes.
- Dispatch existing `Release Build` workflow on this branch with `build_android=true`, `build_windows=false`, `build_macos=false`.
- The workflow's publish job is tag-only; a branch dispatch must skip it.
- Build a normal non-debug arm64 Release APK using the original repository signing secrets. Secrets remain solely in GitHub Actions; do not export them locally.
- Keep app version 0.6.0 for this preview rather than reserving a production release version. Same package, version code and original certificate allow replacement of the released 0.6.0 without intentionally requiring a downgrade. Verify actual metadata/certificate after downloading. Never uninstall user data to bypass a mismatch.
- Actions artifact is `BiNote-Android`; downloaded APK should be renamed locally with the branch commit prefix to distinguish it from the public v0.6.0 build.
- Phone acceptance remains the user's responsibility. No automatic installation.

## Integration checks before push
- Source backup preserved in stash `6052699527e0dcd4f7bb122fb99f964f61d7951e`; fast-forward branch to v0.6.0, then restore feature changes; no textual merge conflicts.
- `cargo test --lib`: **55 passed**, including summary-template and live-notification tests.
- `npm run test:unit`: passed with the warmed existing target-test cache; first cold attempt hit the wrapper's fixed 60-second timeout, not a test assertion failure.
- `npm run build`: passed.
- `npm run test:ui`: all **8** suites passed, including summary-template interactions.
- Node Android sync/navigation contracts: **4 passed**.
- Signing regression: **8 passed**.
- `:app:testArm64DebugUnitTest`: passed.
- `:app:lintVitalArm64Release`: passed.
- Full lint retains previously documented TV-manifest errors; not represented as fully green. Release vital gate is separately verified.
- No UI/business logic changes were added for synchronization. Existing progress payloads, task flags, template snapshots and completion notifications retained.

## Analysis
The independent worktree GitNexus rebuild completed: alias `binote-live-notifications`, 1,799 nodes, 4,151 edges, 154 flows. Staged detect-changes succeeded: 32 expected files, 267 symbols, 25 flows; aggregate risk CRITICAL, disclosed to the user before committing. Many counted symbols are the previously ignored native baseline now tracked; this does not negate lifecycle/navigation risks. Checked affected service start/update/parser/intent/dismissal paths and Rust progress/publisher flows against the tests and source review. No unrelated template implementation changes are staged. The earlier emit_progress impact is HIGH (7 direct callers, 3 process groups); reviewed call sites remain outside registry lock scopes. Index warns some process traversal and cross-language property inference are incomplete, so absence of edges is not proof of no impact.

## CI acceptance
Record the commit, Actions URL, final APK metadata, size, hash and original-certificate result in the user handoff. A successful build/eligibility test does not prove Find X8/ColorOS17 promotion. Failure must not be hidden by skipping relevant tests, replacing signing keys, or publishing an unverified APK.
