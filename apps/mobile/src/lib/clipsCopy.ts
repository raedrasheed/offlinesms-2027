import { useTranslation } from 'react-i18next';

/** Localized feature copy stays next to each control, keeping Arabic complete
 * without concurrent edits to the app's shared dictionaries. */
export function useClipsCopy() {
  const { i18n } = useTranslation();
  const rtl = (i18n.resolvedLanguage ?? i18n.language ?? 'en').startsWith('ar');
  return { rtl, c: (english: string, arabic: string): string => rtl ? arabic : english };
}
export function clipCount(value: number): string {
  const n = Math.max(0, Number.isFinite(value) ? value : 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}
