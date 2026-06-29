import { describe, it, expect } from 'vitest';
import { toggleReaction } from '../../src/localdb/sync/reactionLogic';

describe('toggleReaction (mirrors server reactToMessage)', () => {
  it('adds a reaction when none exists', () => {
    expect(toggleReaction(null, '👍', 'u1')).toEqual({ '👍': ['u1'] });
  });

  it('toggles the same emoji off, returning null when empty', () => {
    expect(toggleReaction({ '👍': ['u1'] }, '👍', 'u1')).toBeNull();
  });

  it('replaces the user\'s previous emoji (one per user)', () => {
    expect(toggleReaction({ '👍': ['u1'] }, '❤️', 'u1')).toEqual({ '❤️': ['u1'] });
  });

  it('keeps other users\' reactions when one user toggles', () => {
    expect(toggleReaction({ '👍': ['u1', 'u2'] }, '👍', 'u1')).toEqual({ '👍': ['u2'] });
  });

  it('adds a user to an existing emoji', () => {
    expect(toggleReaction({ '👍': ['u2'] }, '👍', 'u1')).toEqual({ '👍': ['u2', 'u1'] });
  });

  it('moving a user between emojis cleans the old bucket and drops it if empty', () => {
    expect(toggleReaction({ '👍': ['u1'], '❤️': ['u2'] }, '❤️', 'u1'))
      .toEqual({ '❤️': ['u2', 'u1'] });
  });

  it('accepts a custom emoji from the full picker (add / replace / remove)', () => {
    // add a non-default emoji
    expect(toggleReaction(null, '🥳', 'u1')).toEqual({ '🥳': ['u1'] });
    // replace a default reaction with the custom one
    expect(toggleReaction({ '👍': ['u1'] }, '🥳', 'u1')).toEqual({ '🥳': ['u1'] });
    // toggling the same custom emoji off clears it
    expect(toggleReaction({ '🥳': ['u1'] }, '🥳', 'u1')).toBeNull();
  });

  it('groups counts by emoji across users', () => {
    const map = toggleReaction({ '🔥': ['u2', 'u3'] }, '🔥', 'u1')!; // u1 joins 🔥
    const grouped = Object.entries(map).map(([emoji, uids]) => ({ emoji, count: uids.length }));
    expect(grouped).toEqual([{ emoji: '🔥', count: 3 }]);
  });
});
