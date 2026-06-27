# design-sync notes — BiNote

## Repo classification
- **BiNote is a Tauri desktop/Android application, not a design-system / component library.**
- No library build target (`package.json` has no `main`/`module`/`exports`), no Storybook, `dist/` is an app bundle.
- The `src/components/` entries (`ConfirmModal`, `CopyButton`, `ErrorModal`, `MermaidRenderer`) are app-coupled (Tauri `invoke`, routing, contexts), so they are **not** synced as design-system components. `src/components/ui/` is empty.

## Sync scope (user choice, 2026-06-28)
- **Tokens + brand only.** Off-script `tokens-only` shape — the standard package/storybook converter is not run.
- Source of truth for tokens: `binote/tailwind.config.js` (`theme.extend`).
- Fonts: `@fontsource/manrope` + `@fontsource/newsreader` (from `node_modules`).

## Layout produced (off-script)
- `styles.css` — entry; `@import`s the token files + font faces, sets base body styles.
- `tokens/*.css` — CSS custom properties for colors, typography, shadows, effects.
- `fonts/` — woff2 + `@font-face` for Manrope (sans) and Newsreader (display).
- No `_ds_sync.json` anchor for the tokens-only shape (off-script recipe); next sync re-derives from `tailwind.config.js`.

## IMPORTANT: the pane needs preview cards, not just tokens
- The Design System pane builds its visible card index from preview HTML files whose
  **first line** is `<!-- @dsCard group="…" name="…" subtitle="…" -->`. Uploading only
  `styles.css`/`tokens/`/`fonts/` makes designs render on-brand but leaves the pane
  showing "This design system is empty".
- Fix used: 4 foundation cards under `ds-bundle/components/foundation/<Name>/<Name>.html`
  (Colors, Typography, Elevation, Brand), each linking `../../../styles.css` and
  visualizing the tokens. Each carries an `@dsCard` first line, group="Foundation".
- After upload, re-writing the `_ds_needs_recompile` sentinel triggers the app self-check,
  which compiles `_ds_manifest.json` (+ `_ds_bundle.js`, `_adherence.oxlintrc.json`) remotely.
- These card HTML files live only in the gitignored `ds-bundle/`; regenerate them on re-sync.

## Re-sync
- If `tailwind.config.js` changes, regenerate the token CSS from `theme.extend`.
- Keep `.design-sync/conventions.md` (the README header) truthful: every token/class named there must exist in the generated CSS.
