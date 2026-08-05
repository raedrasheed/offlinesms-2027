import { describe, it, expect } from 'vitest';
import { isAllowedReactionEmoji } from '../src/chats/reactToMessage';

describe('isAllowedReactionEmoji', () => {
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
