# Design Tokens — Semantic Layer

Phase 1 introduces a **semantic, role-based token layer** layered on top of the existing raw palette in `@offlinesms/design-tokens`. The raw layer remains for back-compat; the semantic layer is what new code should consume.

---

## Why

Raw tokens (`ink`, `surface`, `canvas`, `primary`, `ok`, `err`) describe what a color **is**. Semantic tokens describe **what it's for** (`text.primary`, `background.surface`, `state.error`). This separation:

- Makes dark mode a one-file swap (Phase 19).
- Keeps RTL/locale concerns orthogonal to color choices.
- Lets the brand evolve without touching every component.

---

## Where to find them

- Source: `packages/design-tokens/src/semantic.ts`
- Re-export: `packages/design-tokens/src/index.ts` (`semantic`, `lightSemantic`, `darkSemantic`, `SemanticTokens`)
- Tailwind preset: `packages/design-tokens/tailwind-preset.js`

---

## Token map

### `color.background`

| Token | Light | Dark | Purpose |
|---|---|---|---|
| `app` | `#EEF1F6` | `#0A0F1C` | Page background |
| `surface` | `#FFFFFF` | `#131A2C` | Cards, panels |
| `subtle` | `#F7F8FB` | `#18203A` | Subdued surfaces |
| `sunken` | `#F1F3F8` | `#0A0F1C` | Inset / well |
| `raised` | `#FFFFFF` | `#18203A` | Floating elements |
| `inverse` | `#0B1220` | `#FFFFFF` | High-contrast strip (sidebar) |

### `color.text`

| Token | Light | Dark |
|---|---|---|
| `primary` | `#0B1220` | `#F2F4FA` |
| `secondary` | `#2A3650` | `#E2E5EC` |
| `muted` | `#6B7488` | `#98A0B3` |
| `disabled` | `#98A0B3` | `#475067` |
| `inverse` | `#FFFFFF` | `#0B1220` |
| `onPrimary` | `#FFFFFF` | `#FFFFFF` |
| `link` | `#1F7BA8` | `#C9E0EC` |

### `color.border`

| Token | Light | Dark |
|---|---|---|
| `subtle` | `#EEF0F4` | `#16223A` |
| `default` | `#E2E5EC` | `#2A3650` |
| `strong` | `#C7CCD7` | `#475067` |
| `focus` | `#1F7BA8` | `#C9E0EC` |

### `color.action`

| Token | Light | Dark |
|---|---|---|
| `primary` | `#1F7BA8` | `#1F7BA8` |
| `primaryHover` | `#186E97` | `#186E97` |
| `primaryPressed` | `#155E83` | `#155E83` |
| `primaryFg` | `#FFFFFF` | `#FFFFFF` |
| `subtle` | `#F4F9FC` | `#16223A` |
| `subtleFg` | `#155E83` | `#C9E0EC` |

### `color.state`

| Token | Light | Dark |
|---|---|---|
| `success` | `#22C55E` | `#22C55E` |
| `warning` | `#F59E0B` | `#F59E0B` |
| `error` | `#EF4444` | `#EF4444` |
| `info` | `#1F7BA8` | `#C9E0EC` |

---

## How to use

### TypeScript / React Native (mobile)

```ts
import { semantic } from '@offlinesms/design-tokens';

const styles = StyleSheet.create({
  card: {
    backgroundColor: semantic.color.background.surface,
    borderColor: semantic.color.border.default,
  },
  title: { color: semantic.color.text.primary },
  helper: { color: semantic.color.text.muted },
  destructive: { color: semantic.color.state.error },
});
```

### Tailwind (dashboard)

The preset exposes new utilities **alongside** the existing ones. Both work.

```tsx
// New, preferred:
<div className="bg-bg-surface text-text-primary border border-border-default">
  …
</div>

<button className="bg-action-primary hover:bg-action-primaryHover text-action-primaryFg">
  Continue
</button>

<p className="text-state-error">Something went wrong.</p>
```

```tsx
// Existing utilities still work — no migration required:
<div className="bg-surface text-ink border border-ink-200">…</div>
```

---

## Back-compatibility guarantee

- The raw exports (`colors`, `typography`, `spacing`, `radius`, `shadows`) are unchanged.
- Existing Tailwind classes (`bg-canvas`, `text-ink-500`, `bg-primary`, …) keep their values.
- No file outside `packages/design-tokens/` was renamed.

---

## Dark mode

`darkSemantic` is exported but not wired to any provider yet. Phase 19 adds a theme provider that picks `lightSemantic` or `darkSemantic` based on user preference and writes CSS variables on `<html>`.

---

## RTL

Color tokens are direction-agnostic. The mobile app already forces RTL for Arabic via `I18nManager`. The dashboard's RTL pass lands in Phase 19.

---

## Adding a new semantic token

1. Add the key to both `lightSemantic` and `darkSemantic` in `packages/design-tokens/src/semantic.ts`.
2. Mirror it in `packages/design-tokens/tailwind-preset.js` under the appropriate group (`bg.*`, `text.*`, `border.*`, `action.*`, `state.*`).
3. Add a row to the table in this file.
4. **Never** add a raw color to UI code — pick or add a semantic token first.
