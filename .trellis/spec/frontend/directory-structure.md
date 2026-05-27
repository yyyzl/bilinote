# Directory Structure

> How frontend code is organized in this project.

---

## Overview

The frontend is a **React 18** application built with **TypeScript**, **Vite**, and **Tailwind CSS**. It runs inside a **Tauri v2** webview and communicates with the Rust backend via Tauri's `invoke` API.

---

## Directory Layout

```
binote/src/
├── main.tsx                 # Entry point: global function registration (Android bridge)
├── App.tsx                  # Router configuration (HashRouter + ShareProvider)
├── pages/                   # Page-level components (one per route)
│   ├── Dashboard.tsx        # Main page: note list, Bilibili link input, batch operations
│   ├── Settings.tsx         # Settings page: API key configuration, ASR provider selection
│   └── NoteDetail.tsx       # Note detail: transcript display, AI summary, mindmap
├── components/              # Reusable UI components
│   ├── ErrorModal.tsx       # Error display modal + formatError() utility
│   ├── ConfirmModal.tsx     # Confirmation dialog with a11y support
│   └── MermaidRenderer.tsx  # Mermaid diagram renderer component
├── contexts/                # React Context providers
│   └── ShareContext.tsx     # Android share intent handling + navigation
├── lib/                     # Business logic and API layer
│   ├── tauri.ts            # Tauri command wrappers + type definitions
│   └── share.ts            # Android share bridge (pre-React buffer)
└── styles/
    └── globals.css          # Global styles, safe area, custom animations
```

### Related Config Files

```
binote/
├── package.json             # Dependencies (React 18, Tauri API v2, Mermaid, Lucide)
├── tsconfig.json            # TypeScript config (strict mode, path aliases)
├── vite.config.ts           # Vite config (port 5173, @ alias)
├── tailwind.config.js       # Tailwind theme (terracotta primary #b75d3e + canvas/paper/ink/sage/gold palette)
└── index.html               # HTML entry point
```

---

## Module Organization

### Layered Architecture

```
Pages (UI + state) → Components (reusable UI) → Lib (business logic + API)
         ↕
     Contexts (shared state)
```

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| **Pages** | `pages/` | Route-level components, page state, orchestration |
| **Components** | `components/` | Reusable UI elements (modals, renderers) |
| **Contexts** | `contexts/` | Cross-page shared state (e.g., share intent) |
| **Lib** | `lib/` | Tauri API wrappers, type definitions, utilities |
| **Styles** | `styles/` | Global CSS, animations, safe area variables |

### Adding New Features

**New page**:
1. Create `pages/NewPage.tsx`
2. Add route in `App.tsx`: `<Route path="/new" element={<NewPage />} />`
3. Use `Link` for navigation

**New reusable component**:
1. Create `components/ComponentName.tsx`
2. Define `interface ComponentNameProps` at top
3. Use `export default function ComponentName()`

**New Tauri command wrapper**:
1. Add type definition in `lib/tauri.ts`
2. Add invoke wrapper function in `lib/tauri.ts`
3. Import from pages via `import * as api from "@/lib/tauri"`

---

## Naming Conventions

| Element | Convention | Examples |
|---------|-----------|----------|
| Page files | `PascalCase.tsx` | `Dashboard.tsx`, `NoteDetail.tsx` |
| Component files | `PascalCase.tsx` | `ErrorModal.tsx`, `ConfirmModal.tsx` |
| Context files | `PascalCase.tsx` | `ShareContext.tsx` |
| Lib files | `camelCase.ts` | `tauri.ts`, `share.ts` |
| CSS files | `camelCase.css` | `globals.css` |
| Interfaces | `PascalCase` | `ErrorModalProps`, `ShareContextType` |
| Type aliases | `PascalCase` | `AsrProvider`, `TabType`, `GenerateType` |
| Functions | `camelCase` | `formatError`, `loadNotes`, `handleSubmit` |
| Constants | `UPPER_SNAKE_CASE` | `GENERATE_CONFIG` |

---

## Path Aliases

Configured in both `tsconfig.json` and `vite.config.ts`:

```typescript
// Import from anywhere using @/ prefix
import * as api from "@/lib/tauri";
import ErrorModal from "@/components/ErrorModal";
```

`@/*` maps to `./src/*`

---

## Examples

- **Page with complex state**: `Dashboard.tsx` — multiple useState, polling, event listeners, multi-select
- **Reusable modal**: `ConfirmModal.tsx` — props interface, a11y attributes, keyboard handling
- **API layer**: `lib/tauri.ts` — typed invoke wrappers, event listener registration
- **Context + Hook**: `ShareContext.tsx` — provider pattern with `useShare()` guard hook
