# OfflineSMS Localization Checklist

Phase 19 implementation reference. Supported locales: **English (en)**, **Arabic (ar)**.

---

## Adding a new string

1. Add the key to `apps/mobile/src/i18n/en.json`
2. Add the matching key with Arabic translation to `apps/mobile/src/i18n/ar.json`
3. Run `npm run i18n:check` from the repo root — the script will fail if any key is missing or extra in any locale
4. Use `t('namespace.key')` in the component — never hardcode user-facing strings

## Adding a new namespace

Add the namespace object to both `en.json` and `ar.json` at the same nesting level, then re-run `npm run i18n:check`.

## Parity check script

```sh
npm run i18n:check          # from repo root
npm run i18n:check          # from apps/mobile (via package.json script)
```

The script (`scripts/checkI18n.ts`) recursively flattens all keys in every locale JSON and compares against English. It exits non-zero on:
- Keys present in EN but missing in another locale
- Keys present in another locale but absent from EN (orphaned)

**This script must pass before merging any PR that touches `src/i18n/*.json`.**

---

## Mobile component checklist

- [ ] All user-facing strings use `t('namespace.key')` via `useTranslation()`
- [ ] Plurals use i18next `_one` / `_other` suffix convention
- [ ] Interpolated strings use `t('key', { variable })` — not template literals
- [ ] Dates are formatted with `toLocaleDateString([], ...)` using device locale
- [ ] Numbers are formatted with `toLocaleString()` using device locale
- [ ] No hardcoded strings in `StyleSheet` (string values that users see)
- [ ] No hardcoded direction assumptions (use `isRTL` from `src/i18n/index.ts`)

## RTL-specific checklist

- [ ] `I18nManager.forceRTL(true)` is called when switching to Arabic (in `changeLanguage()`)
- [ ] A full app restart is required for `I18nManager` changes to take effect — the restart prompt is shown to the user
- [ ] All flex containers use `flexDirection: rtl ? 'row-reverse' : 'row'`
- [ ] All text blocks use `textAlign: rtl ? 'right' : 'left'`
- [ ] Timestamps use `writingDirection: 'ltr'` (prevents digit reversal in Arabic RTL layout)
- [ ] Chevrons/arrows flip direction (`isRTL ? '›' : '‹'`)

---

## Dashboard

The admin dashboard is currently English-only. Admin labels are centralized in `apps/dashboard/lib/i18n.ts` (`ADMIN_LABELS`). When adding a new dashboard page:

- [ ] Use `ADMIN_LABELS` for nav labels, action labels, and status strings
- [ ] Use `lang="en"` and `dir="ltr"` on the root HTML element (set in `app/layout.tsx`)

---

## Translation guidelines for Arabic

- Use Modern Standard Arabic (فصحى)
- Preserve product name "OfflineSMS" untranslated
- Phone numbers, IDs, and codes remain LTR (wrap in `<bdi>` in HTML, use `writingDirection: 'ltr'` in RN)
- Avoid contractions — prefer full forms
- Currency and unit labels follow Arabic conventions

---

## Current locale key count

Run `npm run i18n:check` to see the current count. As of Phase 19: **276 keys per locale**.
