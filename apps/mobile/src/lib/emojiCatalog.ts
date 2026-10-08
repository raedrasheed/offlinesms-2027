// Composer emoji picker model — pure (no React Native), unit-tested.
//
// • Categories come from Unicode CLDR order (src/lib/emojiData.ts, generated).
// • Emoji newer than the device's system font are hidden, so the picker never
//   shows empty "tofu" boxes (Android API level / iOS version → Emoji version).
// • Search matches English AND Arabic CLDR keywords whatever the UI language;
//   the keyword table (~200 KB source, ~65 KB compressed) is only parsed on the
//   first search, so opening the picker stays fast.

import { EMOJI_GROUP_DATA, EMOJI_VERSIONS } from './emojiData';

export type EmojiGroupKey =
  'smileys' | 'people' | 'nature' | 'food' | 'travel' | 'activities' | 'objects' | 'symbols' | 'flags';

export interface EmojiGroup { key: EmojiGroupKey; icon: string; emojis: string[] }

/** Highest Unicode Emoji version the platform's system emoji font renders. */
export function maxEmojiVersionFor(os: string, version: string | number | undefined): number {
  if (os === 'android') {
    const api = typeof version === 'number' ? version : parseInt(String(version ?? '0'), 10);
    if (api >= 36) return 16;
    if (api >= 35) return 15.1;
    if (api >= 34) return 15;
    if (api >= 33) return 14;
    if (api >= 31) return 13.1;
    if (api >= 30) return 13;
    if (api >= 29) return 12;
    if (api >= 28) return 11;
    if (api >= 26) return 5;
    if (api >= 25) return 4;
    return 3;
  }
  if (os === 'ios') {
    const [maj, min] = String(version ?? '0').split('.').map(n => parseInt(n, 10) || 0);
    const v = maj + min / 10;
    if (v >= 18.4) return 16;
    if (v >= 17.4) return 15.1;
    if (v >= 16.4) return 15;
    if (v >= 15.4) return 14;
    if (v >= 14.5) return 13.1;
    if (v >= 14.2) return 13;
    if (v >= 13.2) return 12.1;
    return 11;
  }
  return Infinity; // web: the browser's own font; show everything
}

const cache = new Map<number, EmojiGroup[]>();

/** Categories with every emoji the device can render. Memoized per version. */
export function emojiGroups(maxVersion: number): EmojiGroup[] {
  const hit = cache.get(maxVersion);
  if (hit) return hit;
  const groups = EMOJI_GROUP_DATA.map(g => {
    const chars = g.chars.split('|');
    const emojis = chars.filter((_, i) => EMOJI_VERSIONS[parseInt(g.versions[i], 36)] <= maxVersion);
    return { key: g.key as EmojiGroupKey, icon: g.icon, emojis };
  }).filter(g => g.emojis.length > 0);
  cache.set(maxVersion, groups);
  return groups;
}

// ── Grid rows (virtualized list: headers + fixed-height rows) ────────────────

export type PickerRow =
  | { type: 'header'; key: string; section: string }
  | { type: 'row'; key: string; section: string; items: string[] };

export interface PickerSection { key: string; items: string[] }

export function buildRows(sections: PickerSection[], columns: number): { rows: PickerRow[]; sectionStart: Record<string, number> } {
  const rows: PickerRow[] = [];
  const sectionStart: Record<string, number> = {};
  for (const s of sections) {
    if (s.items.length === 0) continue;
    sectionStart[s.key] = rows.length;
    rows.push({ type: 'header', key: `h:${s.key}`, section: s.key });
    for (let i = 0; i < s.items.length; i += columns) {
      rows.push({ type: 'row', key: `${s.key}:${i}`, section: s.key, items: s.items.slice(i, i + columns) });
    }
  }
  return { rows, sectionStart };
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Fold case/diacritics and the common Arabic spelling variants. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')       // Latin accents
    .replace(/[ً-ٰٟـ]/g, '')             // Arabic harakat + tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

interface IndexEntry { char: string; name: string; text: string }
let index: IndexEntry[] | null = null;

// Deferred: the keyword table is only required (and parsed) when the user
// first searches. Tests inject the module since node can't require() TS.
let keywordLoader: () => string = () =>
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  (require('./emojiKeywords') as { EMOJI_KEYWORDS: string }).EMOJI_KEYWORDS;
export function setEmojiKeywordLoader(load: () => string): void { keywordLoader = load; index = null; }

function loadIndex(): IndexEntry[] {
  if (index) return index;
  index = keywordLoader().split('\n').map(line => {
    const [char, en = '', ar = ''] = line.split('\t');
    const name = normalizeSearch(en.split(' ').slice(0, 3).join(' '));
    return { char, name, text: ` ${normalizeSearch(en)} ${normalizeSearch(ar)} ` };
  });
  return index;
}

/**
 * Emoji whose keywords contain every word of the query (prefix match on words),
 * limited to what the device renders. Word-start matches rank first.
 */
export function searchEmoji(query: string, maxVersion: number, limit = 120): string[] {
  const q = normalizeSearch(query);
  if (!q) return [];
  const allowed = new Set(emojiGroups(maxVersion).flatMap(g => g.emojis));
  const words = q.split(' ');
  const scored: Array<{ char: string; score: number; i: number }> = [];
  loadIndex().forEach((e, i) => {
    if (!allowed.has(e.char)) return;
    let score = 0;
    for (const w of words) {
      const at = e.text.indexOf(w);
      if (at < 0) return;
      score += e.text[at - 1] === ' ' ? 2 : 1;
    }
    if (e.name.startsWith(q)) score += 3;
    scored.push({ char: e.char, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map(s => s.char);
}

/** Insert text at the composer's selection; returns the new draft and caret. */
export function insertAtSelection(draft: string, sel: { start: number; end: number } | null, text: string): { draft: string; caret: number } {
  const start = Math.max(0, Math.min(sel?.start ?? draft.length, draft.length));
  const end = Math.max(start, Math.min(sel?.end ?? start, draft.length));
  return { draft: draft.slice(0, start) + text + draft.slice(end), caret: start + text.length };
}
