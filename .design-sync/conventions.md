# BiNote — Editorial Paper design language

This is a **token + brand foundation**, not a component library. It gives you BiNote's
look — colors, fonts, elevation, and the signature paper background — so designs come
out on-brand. Build your own layout and components; dress them in these tokens.

## The aesthetic

Warm, editorial, paper-like — close to Claude.ai. A **terracotta** primary
(`#b75d3e`) sits on **warm canvas/paper** neutrals with **ink-toned** text and quiet
**sage**/**gold** accents. Surfaces are soft cards with low-opacity warm shadows over a
subtle radial **paper glow** background. Pair a **serif display** face (Newsreader) for
headings with a **humanist sans** (Manrope) for UI and body.

## How styling works here

Rendered designs receive `styles.css` and its `@import` closure — **CSS custom
properties**, not a Tailwind/utility pipeline. Style with `var(--*)` tokens (and the few
helper classes below). Do **not** write Tailwind utility classes like `bg-primary-500`
expecting them to resolve — they won't here. (The source app does use Tailwind with these
same token names, but that build isn't shipped.)

### Read these first
- `styles.css` — base styles + helper classes (the entry; imports everything).
- `tokens/colors.css`, `tokens/typography.css`, `tokens/shadows.css`, `tokens/effects.css`
  — the full token vocabulary with exact values.

### Color tokens (`var(--color-…)`)
- **Brand:** `--color-primary-50 … --color-primary-800`; base is `--color-primary-500`
  (`#b75d3e`), hover/active `--color-primary-600`.
- **Backgrounds:** `--color-canvas-50…300` (app bg), `--color-paper-50…200` (cards/surfaces).
- **Text & borders:** `--color-ink-50 … --color-ink-900`; body text `--color-ink-800`,
  muted `--color-ink-500`, hairline borders `--color-ink-100`/`200`.
- **Accents:** `--color-sage-100…700` (cool green), `--color-gold-100…500` (warm).
- **Semantic aliases:** `--color-brand`, `--color-bg`, `--color-surface`, `--color-text`,
  `--color-text-muted`, `--color-border`.

### Typography
- `--font-sans` — Manrope (+ CJK fallbacks). UI and body.
- `--font-display` — Newsreader serif (+ CJK fallbacks). Headings only.
- Weights: 400/500/600 (Manrope also 700). `h1–h4` already use the display face.

### Elevation & effects
- Shadows: `--shadow-soft` (cards), `--shadow-panel` (raised panels), `--shadow-float`
  (modals/popovers), `--shadow-inset` (top highlight). Radii: `--radius-sm…xl`.
- Background glow: `--bg-paper-glow` (applied to `body` by default; reuse via `.binote-glow`).

### Helper classes
- `.binote-surface` — the core paper card (surface bg + hairline border + soft shadow + lg radius).
- `.binote-panel` / `.binote-float` — swap in heavier elevation.
- `.binote-btn-primary` — terracotta primary action; `.binote-btn-secondary` — quiet paper-toned action.

## Idiomatic snippet

```html
<section class="binote-surface" style="padding:1.5rem;max-width:28rem;">
  <h2>转录完成</h2>
  <p style="color:var(--color-text-muted);">
    已生成 AI 总结，可在笔记详情中查看。
  </p>
  <div style="display:flex;gap:0.75rem;margin-top:1.25rem;">
    <button class="binote-btn-primary">查看笔记</button>
    <button class="binote-btn-secondary">关闭</button>
  </div>
</section>
```
