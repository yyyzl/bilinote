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
- Node Android sync/navigation/CI-runtime contracts: **5 passed** after the Java21 CI fix.
- Signing regression: **8 passed**.
- `:app:testArm64DebugUnitTest`: passed.
- `:app:lintVitalArm64Release`: passed.
- Full lint retains previously documented TV-manifest errors; not represented as fully green. Release vital gate is separately verified.
- No UI/business logic changes were added for synchronization. Existing progress payloads, task flags, template snapshots and completion notifications retained.

## Analysis
The independent worktree GitNexus rebuild completed: alias `binote-live-notifications`, 1,799 nodes, 4,151 edges, 154 flows. Staged detect-changes succeeded: 32 expected files, 267 symbols, 25 flows; aggregate risk CRITICAL, disclosed to the user before committing. Many counted symbols are the previously ignored native baseline now tracked; this does not negate lifecycle/navigation risks. Checked affected service start/update/parser/intent/dismissal paths and Rust progress/publisher flows against the tests and source review. No unrelated template implementation changes are staged. The earlier emit_progress impact is HIGH (7 direct callers, 3 process groups); reviewed call sites remain outside registry lock scopes. Index warns some process traversal and cross-language property inference are incomplete, so absence of edges is not proof of no impact.

## First CI run and repair
Run `39984307896` at `072597c` compiled the Release APK successfully but stopped before signing/upload: Robolectric's API36 sandbox rejected GitHub's Java17 (`DefaultSdkProvider.java:174`). Confirmed against Robolectric 4.17 published source: SDK36's requiredJavaVersion is 21. Local passing tests used Java21. Added a failing Node regression for the Android workflow Java version, then changed only that job to JDK21; kept all native tests and signing gates enabled. No Android runtime/business logic change.

## Verified delivery
- App/CI commit: `76da5571bb29504f613eb2509c67a0171a38987f` (feature commit `072597c`, Java21 repair `76da557`).
- Actions success: https://github.com/yyyzl/bilinote/actions/runs/39986274722
- Artifact: https://github.com/yyyzl/bilinote/actions/runs/39986274722/artifacts/12516027438 (`BiNote-Android`; GitHub sign-in may be required).
- Local verified file: `G:/AndroidAPP/biliGPT-live-notifications/binote/BiNote_0.6.0_live_76da557_arm64.apk`.
- Size: **22,037,759 bytes**, about 22.04 MB / 21.02 MiB. The Actions artifact ZIP itself is smaller; do not confuse its digest with the APK digest.
- APK SHA256: `F33C29FFDEE7381D52B578E6770C26FC8168DD28EF037BBE92D69A96B8A09806`.
- Package `com.binote.app`, versionName `0.6.0`, versionCode `6000`, minSdk24, targetSdk36, native ABI only `arm64-v8a`; aapt reports no application-debuggable flag.
- Actual downloaded APK passed apksigner and the project legacy-certificate gate locally, plus zipalign validation. Rust native library is 19,420,816 bytes rather than the debug build's 177 MB library.
- Android Release build, API35/36 native tests, signing and artifact upload all succeeded in CI. Windows, macOS and Publish GitHub Release jobs were skipped.
- Remote main remains `62837d4`; Latest remains v0.6.0, release ID421104819 / original publication time unchanged. No release/tag/main merge was performed.
- Install only by update/replacement, retaining app data. Do not uninstall or clear data to bypass conflicts. Actual phone upgrade and Fluid Cloud presentation have not been tested.

## CI acceptance
A successful build/eligibility test does not prove Find X8/ColorOS17 promotion. User should test background/locked states, actual stage updates, warm/cold taps, completion/failure/cancel cleanup, concurrent work, permission fallback and dismissal/new batch. Full Android lint retains documented non-vital inherited TV issues; do not conflate passing lintVital with all lint passing.
