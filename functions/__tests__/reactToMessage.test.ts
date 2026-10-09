import { describe, it, expect } from 'vitest';
import { isAllowedReactionEmoji } from '../src/chats/reactionEmoji';
import { EMOJI_GROUP_DATA } from '../../apps/mobile/src/lib/emojiData';

describe('isAllowedReactionEmoji', () => {
  it('accepts every emoji offered by the shared client catalog', () => {
    const all = EMOJI_GROUP_DATA.flatMap(g => g.chars.split('|'));
    expect(all.length).toBeGreaterThan(1900);
    expect(all.filter(e => !isAllowedReactionEmoji(e))).toEqual([]);
  });

  it('accepts complete country flags and keycap emoji', () => {
    for (const e of ['🇵🇸', '🇯🇴', '🇺🇸', '1️⃣', '0️⃣', '#️⃣', '*️⃣', 'ℹ️']) {
      expect(isAllowedReactionEmoji(e), e).toBe(true);
    }
  });

  it('rejects bare, partial or concatenated flag/keycap syntax and surrounding text', () => {
    for (const e of ['🇵', '🇵🇸🇯', '🇵🇸🇯🇴', '12️⃣', '1', '#', '*', '1️⃣2️⃣', '🇵🇸 hello', '1️⃣ stars', 'ℹ️ info']) {
      expect(isAllowedReactionEmoji(e), e).toBe(false);
    }
  });
  it('accepts the default quick reactions', () => {
    for (const e of ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉']) {
      expect(isAllowedReactionEmoji(e)).toBe(true);
    }
  });

  it('accepts custom emojis from the full picker', () => {
    for (const e of ['🥳', '🦄', '🍕', '🤯', '✅']) {
      expect(isAllowedReactionEmoji(e)).toBe(true);
    }
  });

  it('accepts ZWJ / variation-selector sequences', () => {
    expect(isAllowedReactionEmoji('🏳️‍🌈')).toBe(true);
    expect(isAllowedReactionEmoji('👍🏽')).toBe(true); // skin tone
  });

  it('rejects plain text, empty, and over-long input', () => {
    expect(isAllowedReactionEmoji('hello')).toBe(false);
    expect(isAllowedReactionEmoji('a')).toBe(false);
    expect(isAllowedReactionEmoji('')).toBe(false);
    expect(isAllowedReactionEmoji('   ')).toBe(false);
    expect(isAllowedReactionEmoji('😀😀😀😀😀😀😀😀😀')).toBe(false); // too long
    expect(isAllowedReactionEmoji('5️⃣ stars')).toBe(false); // contains letters
  });

  it('rejects non-strings', () => {
    expect(isAllowedReactionEmoji(undefined)).toBe(false);
    expect(isAllowedReactionEmoji(42)).toBe(false);
    expect(isAllowedReactionEmoji(null)).toBe(false);
  });
});

