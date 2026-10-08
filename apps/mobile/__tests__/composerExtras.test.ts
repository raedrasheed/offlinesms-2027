// Emoji picker model, recents, sticker catalog and poll model (client side).
import { describe, it, expect, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@react-native-async-storage/async-storage', () => {
  const mem = new Map<string, string>();
  return { default: { getItem: async (k: string) => mem.get(k) ?? null, setItem: async (k: string, v: string) => { mem.set(k, v); } } };
});

import {
  maxEmojiVersionFor, emojiGroups, buildRows, normalizeSearch, searchEmoji, insertAtSelection, setEmojiKeywordLoader,
} from '../src/lib/emojiCatalog';
import { EMOJI_KEYWORDS } from '../src/lib/emojiKeywords';

setEmojiKeywordLoader(() => EMOJI_KEYWORDS);
import { EMOJI_GROUP_DATA } from '../src/lib/emojiData';
import { pushRecent, createRecentStore } from '../src/lib/recents';
import { STICKER_PACKS, findSticker, parseStickerKey, stickerKey } from '../src/lib/stickers';
import {
  payloadFromRemote, parsePoll, parseSticker, toggleSelection, applyLocalVote, pollView, validatePollDraft, sanitizePoll,
} from '../src/lib/pollModel';
import en from '../src/i18n/en.json';
import ar from '../src/i18n/ar.json';

describe('emoji catalog', () => {
  it('maps platform versions to the emoji the system font renders', () => {
    expect(maxEmojiVersionFor('android', 26)).toBe(5);
    expect(maxEmojiVersionFor('android', 30)).toBe(13);
    expect(maxEmojiVersionFor('android', 34)).toBe(15);
    expect(maxEmojiVersionFor('ios', '15.4')).toBe(14);
    expect(maxEmojiVersionFor('ios', '17.5')).toBe(15.1);
    expect(maxEmojiVersionFor('web', undefined)).toBe(Infinity);
  });

  it('has every category, ~1,900 emoji in total, and hides newer emoji on older devices', () => {
    const all = emojiGroups(Infinity);
    expect(all.map(g => g.key)).toEqual(['smileys', 'people', 'nature', 'food', 'travel', 'activities', 'objects', 'symbols', 'flags']);
    const total = all.reduce((n, g) => n + g.emojis.length, 0);
    expect(total).toBeGreaterThan(1800);
    const old = emojiGroups(11).reduce((n, g) => n + g.emojis.length, 0);
    expect(old).toBeLessThan(total);
    expect(emojiGroups(11).flatMap(g => g.emojis)).not.toContain('🫠'); // Emoji 14
    expect(all.flatMap(g => g.emojis)).toContain('🫠');
    expect(all[0].emojis[0]).toBe('😀');
  });

  it('data stays compact (no skin-tone variants)', () => {
    for (const g of EMOJI_GROUP_DATA) expect(g.chars.split('|').length).toBe(g.versions.length);
    expect(emojiGroups(Infinity).flatMap(g => g.emojis).some(e => /[\u{1F3FB}-\u{1F3FF}]/u.test(e))).toBe(false);
  });

  it('builds fixed rows with section starts for the category bar', () => {
    const { rows, sectionStart } = buildRows([{ key: 'a', items: ['1', '2', '3'] }, { key: 'empty', items: [] }, { key: 'b', items: ['4'] }], 2);
    expect(rows.map(r => r.type)).toEqual(['header', 'row', 'row', 'header', 'row']);
    expect(sectionStart).toEqual({ a: 0, b: 3 });
  });
});

describe('emoji search (English + Arabic)', () => {
  it('normalizes Arabic spelling variants and Latin accents', () => {
    expect(normalizeSearch('أَهْلاً')).toBe(normalizeSearch('اهلا'));
    expect(normalizeSearch('قلبٌ')).toBe('قلب');
    expect(normalizeSearch('Café')).toBe('cafe');
  });
  it('finds emoji by English keywords', () => {
    expect(searchEmoji('heart', Infinity)).toContain('❤️');
    expect(searchEmoji('pizza', Infinity)[0]).toBe('🍕');
    expect(searchEmoji('grinning face', Infinity)).toContain('😀');
  });
  it('finds emoji by Arabic keywords, including flags by country name', () => {
    expect(searchEmoji('قلب', Infinity)).toContain('❤️');
    expect(searchEmoji('بيتزا', Infinity)).toContain('🍕');
    expect(searchEmoji('فلسطين', Infinity).concat(searchEmoji('الفلسطينية', Infinity))).toContain('🇵🇸');
  });
  it('only returns emoji the device can render; empty query → nothing', () => {
    expect(searchEmoji('melting', 13)).not.toContain('🫠');
    expect(searchEmoji('   ', Infinity)).toEqual([]);
  });
  it('inserts at the caret, replacing a selection', () => {
    expect(insertAtSelection('hello world', { start: 5, end: 5 }, '😀')).toEqual({ draft: 'hello😀 world', caret: 7 });
    expect(insertAtSelection('abc', { start: 1, end: 2 }, '🍕')).toEqual({ draft: 'a🍕c', caret: 3 });
    expect(insertAtSelection('abc', null, '!')).toEqual({ draft: 'abc!', caret: 4 });
    expect(insertAtSelection('مرحبا', { start: 5, end: 5 }, ' 👋')).toEqual({ draft: 'مرحبا 👋', caret: 8 });
  });
  it('every category label exists in English and Arabic', () => {
    for (const k of ['recent', 'animated', 'results', ...emojiGroups(Infinity).map(g => g.key)]) {
      expect((en as any).emoji.cat[k], k).toBeTypeOf('string');
      expect((ar as any).emoji.cat[k], k).toBeTypeOf('string');
    }
  });
});

describe('recents', () => {
  it('most recent first, de-duplicated, capped', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b', 3)).toEqual(['b', 'a', 'c']);
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
  });
  it('persists per key', async () => {
    const st = createRecentStore<string>('recents.test:u1', 2);
    await st.add('x'); await st.add('y'); await st.add('x');
    expect(await createRecentStore<string>('recents.test:u1', 2).load()).toEqual(['x', 'y']);
  });
});

describe('stickers', () => {
  it('every sticker has its bundled image and a name in both languages', () => {
    const src = readFileSync(join(__dirname, '../src/components/chat/stickerSources.ts'), 'utf8');
    for (const p of STICKER_PACKS) {
      expect(p.license).toBe('CC0-1.0');
      for (const s of p.stickers) {
        expect(existsSync(join(__dirname, `../assets/stickers/${p.id}/${s.id}.webp`)), s.id).toBe(true);
        expect(src).toContain(`/${p.id}/${s.id}.webp`);
        expect(s.en && s.ar && s.alt).toBeTruthy();
      }
    }
  });
  it('resolves and round-trips recents keys; unknown stickers are rejected', () => {
    expect(findSticker('simsim', 'love')?.alt).toBe('😍');
    expect(parseStickerKey(stickerKey('simsim', 'hi'))).toEqual({ packId: 'simsim', stickerId: 'hi' });
    expect(parseStickerKey('simsim/nope')).toBeNull();
    expect(parseStickerKey('garbage')).toBeNull();
  });
});

describe('poll model', () => {
  const remote = {
    type: 'poll',
    poll: { question: 'Q?', multiple: false, closed: false, options: [{ id: 'o1', text: 'A' }, { id: 'o2', text: 'B' }],
      votes: { u1: ['o1'], u2: ['o2'], u3: ['o1'] }, counts: { o1: 99, o2: 0 }, voterCount: 99 },
  };
  it('stores sticker/poll payloads and recomputes counts from votes (never trusts counts)', () => {
    const p = parsePoll(payloadFromRemote('poll', remote))!;
    expect(p.counts).toEqual({ o1: 2, o2: 1 });
    expect(p.voterCount).toBe(3);
    expect(parseSticker(payloadFromRemote('sticker', { sticker: { packId: 'simsim', stickerId: 'hi', alt: '👋' } }))).toEqual({ packId: 'simsim', stickerId: 'hi', alt: '👋' });
    expect(payloadFromRemote('text', { text: 'x' })).toBeNull();
    expect(parsePoll('not json')).toBeNull();
  });
  it('single choice replaces; multiple choice toggles; tapping my choice retracts', () => {
    const single = sanitizePoll({ ...remote.poll, multiple: false });
    const multi = sanitizePoll({ ...remote.poll, multiple: true });
    expect(toggleSelection(single, ['o1'], 'o2')).toEqual(['o2']);
    expect(toggleSelection(single, ['o1'], 'o1')).toEqual([]);
    expect(toggleSelection(multi, ['o2'], 'o1')).toEqual(['o1', 'o2']);
    expect(toggleSelection(multi, ['o1', 'o2'], 'o1')).toEqual(['o2']);
  });
  it('optimistic vote updates counts, voters and my selection', () => {
    const p = sanitizePoll(remote.poll);
    const next = applyLocalVote(p, 'me', ['o2']);
    const v = pollView(next, 'me');
    expect(v.voterCount).toBe(4);
    expect(v.mine).toEqual(['o2']);
    expect(v.options.map(o => [o.count, o.percent, o.mine])).toEqual([[2, 50, false], [2, 50, true]]);
    expect(pollView(applyLocalVote(next, 'me', []), 'me').voterCount).toBe(3);
  });
  it('validates the creation form like the server', () => {
    expect(validatePollDraft('', ['a', 'b'])).toBe('question');
    expect(validatePollDraft('q', ['a', ' '])).toBe('tooFew');
    expect(validatePollDraft('q', ['Yes', 'yes '])).toBe('duplicate');
    expect(validatePollDraft('q', Array.from({ length: 13 }, (_, i) => `o${i}`))).toBe('tooMany');
    expect(validatePollDraft('وين؟', ['هنا', 'هناك', ''])).toBeNull();
  });
});

describe('Arabic plurals', () => {
  it('poll counts use the Arabic CLDR plural forms', async () => {
    const i18next = (await import('i18next')).default.createInstance();
    await i18next.init({ lng: 'ar', resources: { ar: { translation: ar }, en: { translation: en } }, fallbackLng: 'en' });
    expect(i18next.t('poll.voters', { count: 0 })).toBe('لم يصوّت أحد بعد');
    expect(i18next.t('poll.voters', { count: 2 })).toBe('صوّت شخصان');
    expect(i18next.t('poll.voters', { count: 5 })).toBe('صوّت 5 أشخاص');
    expect(i18next.t('poll.voters', { count: 25 })).toBe('صوّت 25 شخصًا');
    expect(i18next.t('poll.votes', { count: 1 })).toBe('صوت واحد');
    await i18next.changeLanguage('en');
    expect(i18next.t('poll.voters', { count: 5 })).toBe('5 people voted');
  });
});
