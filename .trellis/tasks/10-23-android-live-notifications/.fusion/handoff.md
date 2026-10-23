# Session Handoff — Android live notifications

## Current state
MVP implemented and pushed on `feat/android-live-notifications`, based on released v0.6.0 (`62837d4`). Implementation slice 1 complete; task remains open pending physical-device acceptance. No main merge, release tag, public Release, Latest change or automatic installation.

## Commits and build
- `072597c`: live task notifications, canonical native sources, contracts and tests.
- `76da557`: Android CI JDK21 requirement for Robolectric API36; no app logic change.
- Verified successful build: https://github.com/yyyzl/bilinote/actions/runs/39986274722
- Artifact: https://github.com/yyyzl/bilinote/actions/runs/39986274722/artifacts/12516027438
- Local APK: `binote/BiNote_0.6.0_live_76da557_arm64.apk` (ignored build output, not source).
- APK: 22,037,759 bytes; arm64 Release, not debuggable; versionCode6000/versionName0.6.0.
- APK SHA256: `F33C29FFDEE7381D52B578E6770C26FC8168DD28EF037BBE92D69A96B8A09806`.
- Actual APK original-certificate and ZIP-alignment checks passed locally and in CI.

## Validation
55 Rust tests, 5 Node contracts, 8 UI suites, 8 signing tests, 7 native tests, frontend build, Rust LSP, release lintVital and GitHub Release APK build passed.
Worktree GitNexus index is now available as `binote-live-notifications`; staged scope check succeeded. Initial aggregate CRITICAL scope was disclosed and reviewed; parser/process coverage has documented limits.

## Remaining limitations
- No ADB device connected: Find X8 firmware/API, Fluid Cloud presentation, locked/background behavior, permissions, dismissal and actual upgrade data retention still need phone acceptance.
- Full Android lint retains inherited TV-manifest issues; lintVital is green, not all lint.
- A backup of initial work remains in stash `6052699527e0dcd4f7bb122fb99f964f61d7951e`.
- Original checkout/main and unrelated work were not modified.

## Next
User tests the verified Release APK. Never uninstall/clear data to bypass an install conflict. Use preview-build.md for current delivery; verification.md's v0.5.4 debug results are historical. No merge or public release without further approval.
