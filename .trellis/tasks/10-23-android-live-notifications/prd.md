# Android Live Task Notifications

## Goal
Expose BiNote's user-initiated transcription, summary, and mindmap task state through Android ongoing notifications, requesting Android 16+ Live Update promotion for OPPO Fluid Cloud where supported. Target user's OPPO Find X8 on ColorOS 17; actual OEM promotion requires physical-device validation.

## Confirmed Requirements
- The user approved implementing the previously proposed minimal end-to-end notification feature and explicitly requested a new branch.
- Work on `feat/android-live-notifications` in an isolated worktree at `G:/AndroidAPP/biliGPT-live-notifications`, initially based on `ff4edfa`; synchronized onto released v0.6.0 (`62837d4`) before preview delivery. Preserve all existing work in the original checkout.
- Reuse foreground-service keepalive, show real task stages (no invented percent/ETA), handle concurrent tasks and queued work, and remove live state after completion/failure/cancellation.
- Request promotion only on supported Android versions and when permitted. Ordinary ongoing notifications remain the fallback; disabled notifications must not fail the underlying task.
- Notification tap opens the appropriate note when one exists, otherwise the application task list.
- Respect user dismissal; do not repeatedly request promotion for a dismissed ongoing activity.
- Use Android system notification templates, no overlay permission, OEM private API, root, or OPPO service-library dependency.
- Keep completion notifications; do not hold completed tasks in the live activity.

## Acceptance Criteria

Implementation/automated checks below are complete; Find X8 OEM/device acceptance remains open (see verification.md).
- [x] New feature branch exists without moving/modifying original uncommitted work.
- [x] Real lifecycle and phase state reaches Android without relying on a visible WebView.
- [x] Concurrent tasks do not remove another task's live notification or misroute its tap.
- [x] API 36+ requests promotion with eligible characteristics; older/disabled devices use ordinary notifications.
- [x] Failure, cancellation, process restart and normal completion leave no stale ongoing activity.
- [x] Unit/integration tests cover state transitions, fallback/dismissal, malformed state and navigation.
- [x] Available Rust, frontend regression and Android build/test checks run; remaining device-only checks documented.

## Scope / Decisions
Selected: Android native Live Updates over the existing ongoing service notification. Alternatives researched: OPPO Seedling/UPK requires vendor onboarding; a persistent floating chat UI does not satisfy the intended live-activity use case.
No new chat, floating windows, fake progress, settings redesign, template-feature edits, production release, signing-key changes or automatic installation. Follow-up user approval explicitly authorizes committing/pushing only the feature branch and building a normal signed Release APK through GitHub Actions. Do not merge into main/master, publish a release, alter Latest, or create a release tag.

## Risks and Compatibility
Android expects ongoing, user-initiated, time-sensitive activity; OEM eligibility and user settings control promotion. Device support is not a guarantee that AI processing qualifies. Always retain ordinary-notification fallback. Background execution remains the existing foreground-service concern, independent of promotion.

## References
- https://developer.android.com/develop/ui/views/notifications/live-update
- https://www.ithome.com/0/890/345.htm (ColorOS 16 native API compatibility report)
- https://www.oppo.com/en/newsroom/press/oppo-color-os-17/
- https://open.oppomobile.com/documentation/page/info?id=12715 (vendor service-library requirements)
