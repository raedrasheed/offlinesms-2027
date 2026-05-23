# OfflineSMS Phase 19 Implementation Plan

**Branch:** `claude/repo-audit-architecture-MiZDX`  
**Date:** 2026-05-22  
**Scope:** Localization hardening, RTL support, dark mode, accessibility, user preferences, notification preferences, and documentation checklists.

---

## Objective

Improve product usability and accessibility without adding major new business features. Harden what exists across mobile and dashboard.

---

## Existing i18n Inventory

| File | Keys | Status |
|------|------|--------|
| `apps/mobile/src/i18n/en.json` | ~257 | Complete |
| `apps/mobile/src/i18n/ar.json` | ~257 | Complete, EN parity |
| `apps/mobile/src/i18n/index.ts` | — | i18next + expo-localization; RTL force-set on Arabic |

**Framework:** i18next + react-i18next  
**Languages live:** English, Arabic  
**RTL:** Already force-set in i18n/index.ts via `I18nManager.forceRTL`; no component-level layout fixes yet  
**Gap:** Only `Welcome.tsx` uses `useTranslation()`; all other screens hard-code English strings  
**Future languages ready:** Translation files can be added for fr/es/pt/sk/de/tr by adding `{ [code]: { translation: require('./[code].json') } }` to the resources object  

---

## Existing Theme/Token Inventory

| Resource | Status |
|----------|--------|
| `packages/design-tokens/src/semantic.ts` | Light + dark semantic tokens defined |
| `packages/design-tokens/tailwind-preset.js` | Dashboard CSS tokens |
| `apps/mobile/src/theme/index.ts` | Re-exports raw palette; no context provider |
| `apps/dashboard/tailwind.config.ts` | No `darkMode` key |

**Gap:** No ThemeContext on mobile, no dark Tailwind classes on dashboard.

---

## RTL Strategy

- Mobile: Expose `isRTL` from i18n module. Components use `StyleSheet` with `flexDirection: isRTL ? 'row-reverse' : 'row'` for horizontal layouts. Text alignment uses `textAlign: isRTL ? 'right' : 'left'`. Chevron/back icons mirror with `transform: [{ scaleX: isRTL ? -1 : 1 }]`.
- Numbers, codes, IDs, phone masks, and timestamps are always LTR (`writingDirection: 'ltr'` or wrapping in `<Text dir="ltr">`).
- Dashboard: Add `dir` attribute to `<html>` element when language is Arabic. Prefer Tailwind logical properties (`ps-*`, `pe-*`) over `pl-*`/`pr-*` in future. Phase 19 foundation only — no full sidebar mirror.

---

## Accessibility Strategy

**Mobile:**
- Add `accessible={true}` + `accessibilityLabel` + optional `accessibilityHint` to all interactive Pressable/TouchableOpacity/Switch elements
- Ensure minimum 44×44pt touch targets on action buttons
- Avoid color-only status indication (add text or icon alongside color)
- Disabled buttons: `accessibilityState={{ disabled: true }}`

**Dashboard:**
- Add `aria-label` to icon-only buttons (refresh, close, back)
- Add `role="table"` captions/summaries to data tables
- Ensure `<button>` elements have visible focus rings (Tailwind `focus:ring-2`)
- Ensure global search bar has `aria-label` and `role="combobox"` semantics
- Escape key closes modals/dropdowns where applicable

---

## User Preferences Strategy

**Firestore path:** `users/{uid}` (top-level document, existing)

**New preference fields:**
| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `preferredLanguage` | `'en' \| 'ar'` | device locale | overrides device detection |
| `preferredTheme` | `'system' \| 'light' \| 'dark'` | `'system'` | |
| `inAppNotifications` | `boolean` | `true` | notification inbox placeholder |
| `timeFormat` | `'system' \| '12h' \| '24h'` | `'system'` | |

**smsOptOut strategy:** Keep `smsOptOut` as canonical field (Phase 9). Phase 19 Settings UI maps it as "Important SMS reminders" toggle. No new conflicting field introduced.

**Firestore rules:** Add the 4 new fields to `allowedProfileFields()`.

**Mobile persistence:** Write directly to Firestore (same pattern as `setSmsOptOut`). AsyncStorage used as local cache for theme to avoid flash-of-wrong-theme on cold start.

---

## Mobile Files Affected

| File | Change |
|------|--------|
| `apps/mobile/src/i18n/index.ts` | Export `isRTL`; add `changeLanguage()` helper; add settings keys |
| `apps/mobile/src/i18n/en.json` | Add `settings.*` keys |
| `apps/mobile/src/i18n/ar.json` | Add `settings.*` keys (AR) |
| `apps/mobile/src/lib/user.ts` | Add preference setters + MeDoc fields |
| `apps/mobile/src/theme/index.ts` | Export `getThemeColors(theme)` |
| `apps/mobile/src/context/ThemeContext.tsx` | NEW — dark/light/system context |
| `apps/mobile/src/screens/Settings.tsx` | Add language/theme/notifications pickers; i18n; a11y |
| `apps/mobile/src/screens/ChatsList.tsx` | Apply `useTranslation`; RTL fixes |
| `apps/mobile/src/screens/Conversation.tsx` | RTL composer; a11y on send button |
| `apps/mobile/src/screens/Points.tsx` | Apply `useTranslation`; a11y labels |
| `apps/mobile/src/screens/SupportTicket.tsx` | Apply `useTranslation`; a11y form labels |

---

## Dashboard Files Affected

| File | Change |
|------|--------|
| `apps/dashboard/tailwind.config.ts` | Add `darkMode: 'class'` |
| `apps/dashboard/app/layout.tsx` | Add `dir` attr; aria improvements |
| `apps/dashboard/components/AdminGlobalSearchShell.tsx` | Add `role`, `aria-label` |
| `apps/dashboard/lib/i18n.ts` | NEW — central nav label map |
| `apps/dashboard/app/admin/layout.tsx` (if exists) | Focus ring improvements |

---

## Firestore / User Profile Fields Affected

- Add to `allowedProfileFields()`: `preferredLanguage`, `preferredTheme`, `inAppNotifications`, `timeFormat`
- No schema migration needed (new optional fields default to absent = use device default)

---

## Test Plan

1. `npm run typecheck --workspaces --if-present` — must pass
2. `npm run build --workspaces --if-present` — must pass
3. `npm run i18n:check` — EN/AR parity check must pass
4. Manual: switch language to Arabic → layout RTL, text in Arabic
5. Manual: switch theme to dark → semantic colors applied
6. Manual: SMS reminder toggle still works (smsOptOut unchanged)
7. Manual: Settings accessible via screen reader (all Pressables labeled)
8. Manual: Dashboard search bar keyboard-navigable

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| RTL breaks numeric IDs | Numbers wrapped with explicit `writingDirection: 'ltr'` |
| ThemeContext causes re-renders | Context value memoized; color changes only on theme change |
| Firestore rules drift | New fields explicitly added to allow-list |
| i18n key gaps missed | Parity check script fails CI if keys missing |
| Dashboard dark mode breaks existing classes | `darkMode: 'class'` requires explicit `.dark` class; no automatic changes |

---

## Rollback Plan

All mobile changes are additive (new context, new fields, new styles). Settings screen changes are backwards-compatible (optOut still works). Firestore rules change only adds to allow-list. Dashboard Tailwind dark mode is opt-in (class-based) — no existing classes break.

---

## Acceptance Criteria

All 26 criteria from Phase 19 spec must be satisfied. Key:
- EN/AR parity check script exists and passes
- ThemeContext on mobile with system/light/dark
- Settings shows language + theme + notification preferences
- RTL applied to core screens (ChatsList, Conversation, Settings)
- Accessibility labels on all interactive elements in Settings, Points, SupportTicket
- Dashboard: aria-labels, focus rings, dark mode config
- Firestore rules allow new preference fields
- typecheck + build + i18n:check all pass
