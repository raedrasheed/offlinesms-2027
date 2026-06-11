import { describe, it, expect } from 'vitest';
import { EMOJI_3D, matchAnimatedEmoji } from '../src/lib/emoji3d';

describe('matchAnimatedEmoji', () => {
  it('matches every registered emoji by its own char', () => {
    for (const e of EMOJI_3D) {
      expect(matchAnimatedEmoji(e.char)?.key).toBe(e.key);
    }
  });

  it('ignores surrounding whitespace', () => {
    expect(matchAnimatedEmoji('  😀  ')?.key).toBe('happy');
  });

  it('matches the heart with and without the variation selector', () => {
    expect(matchAnimatedEmoji('❤️')?.key).toBe('heart');
    expect(matchAnimatedEmoji('❤')?.key).toBe('heart');
  });

  it('does not match emoji mixed with text or multiple emojis', () => {
    expect(matchAnimatedEmoji('hello 😀')).toBeNull();
    expect(matchAnimatedEmoji('😀😀')).toBeNull();
    expect(matchAnimatedEmoji('😀 😂')).toBeNull();
  });

  it('does not match unsupported emojis, empty or null input', () => {
    expect(matchAnimatedEmoji('🙃')).toBeNull();
    expect(matchAnimatedEmoji('')).toBeNull();
    expect(matchAnimatedEmoji(null)).toBeNull();
    expect(matchAnimatedEmoji(undefined)).toBeNull();
  });

  it('every registry entry has a distinct key and an animation mood', () => {
    const keys = new Set(EMOJI_3D.map(e => e.key));
    expect(keys.size).toBe(EMOJI_3D.length);
    for (const e of EMOJI_3D) {
      expect(['bounce', 'pulse', 'shake', 'droop', 'wiggle']).toContain(e.mood);
    }
  });
});
