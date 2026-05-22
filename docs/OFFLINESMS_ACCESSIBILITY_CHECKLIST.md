# OfflineSMS Accessibility Checklist

Phase 19 implementation reference. Use this as a review gate before shipping any UI.

---

## Mobile (React Native)

### Interactive elements

- [ ] Every `Pressable`, `TouchableOpacity`, and `Button` has `accessible={true}`, `accessibilityRole`, and `accessibilityLabel`
- [ ] Decorative icons/emoji have `accessibilityElementsHidden` (or `importantForAccessibility="no"` on Android)
- [ ] Toggle controls (Switch, checkbox) have `accessibilityRole="switch"` or `"checkbox"` and `accessibilityState={{ checked }}`
- [ ] Disabled controls set `accessibilityState={{ disabled: true }}`
- [ ] Busy/loading controls set `accessibilityState={{ busy: true }}`

### Navigation

- [ ] Back buttons label is `t('common.back')` and `accessibilityRole="button"`
- [ ] Modal back-swipe / hardware back is tested
- [ ] Screen headers announce the screen title (`accessibilityLabel` on header `Text`)

### Text & color

- [ ] No color-only encoding of information (always paired with text or icon)
- [ ] Minimum contrast 4.5:1 for body text, 3:1 for large text (verified against semantic tokens)
- [ ] `Text` components use semantic color tokens (`colors.text.primary/secondary/muted`) not raw hex

### RTL

- [ ] `flexDirection` uses `rtl ? 'row-reverse' : 'row'`
- [ ] `textAlign` uses `rtl ? 'right' : 'left'`
- [ ] Timestamps use `writingDirection: 'ltr'` to prevent digit reversal
- [ ] Back chevron flips: `isRTL ? '›' : '‹'`
- [ ] FAB mirrors: `isRTL && { right: undefined, left: 18 }`
- [ ] All filter chip rows use RTL-aware flex direction

### Dark mode

- [ ] All components use `useTheme()` colors instead of raw palette or hardcoded hex
- [ ] `buildStyles(colors, rtl)` pattern used (not static `StyleSheet.create` with hardcoded colors)
- [ ] Screen backgrounds use `colors.background.app`
- [ ] Card/surface backgrounds use `colors.background.surface`
- [ ] Borders use `colors.border.subtle` or `colors.border.default`
- [ ] Primary actions use `colors.action.primary`

---

## Dashboard (Next.js)

### Structure

- [ ] `<html lang="en" dir="ltr">` on root layout
- [ ] Skip-to-main-content link present and functional (`.skip-nav`)
- [ ] `<main id="main-content">` landmark exists in admin layout
- [ ] Page-level `<h1>` present on every page
- [ ] Heading hierarchy is logical (h1 → h2 → h3, no skipped levels)

### Interactive elements

- [ ] All `<button>` elements have an `aria-label` if icon-only
- [ ] All form fields have associated `<label>` or `aria-label`
- [ ] All form fields have `aria-required` when required, `aria-invalid` on error
- [ ] All data table columns have meaningful `scope="col"` or `aria-label`
- [ ] Expandable sections have `aria-expanded` on the trigger

### Dialogs & modals

- [ ] Modal containers have `role="dialog"` and `aria-modal="true"`
- [ ] Modals have `aria-label` or `aria-labelledby` pointing to visible title
- [ ] Focus is trapped inside open modals
- [ ] `Escape` key closes modals

### Dynamic content

- [ ] Status messages use `aria-live="polite"` (errors/confirmations) or `"assertive"` (critical only)
- [ ] Loading states announce to screen readers
- [ ] Search results use `role="listbox"` + `role="option"` + `aria-selected`

### Focus

- [ ] `:focus-visible` ring is visible and high-contrast (defined in globals.css)
- [ ] No `outline: none` without a custom visible replacement
- [ ] Tab order follows visual reading order

### Color & contrast

- [ ] Minimum contrast 4.5:1 for normal text, 3:1 for large/bold text
- [ ] Status indicators use both color and text/icon (not color alone)
- [ ] Dark-mode class toggle supported (`darkMode: 'class'` in tailwind.config)

---

## Testing

- Run VoiceOver (iOS) / TalkBack (Android) on all new mobile screens
- Run keyboard-only navigation on all new dashboard pages
- Run `axe` or Lighthouse Accessibility audit on dashboard pages before release
- Test RTL layout by setting device language to Arabic
