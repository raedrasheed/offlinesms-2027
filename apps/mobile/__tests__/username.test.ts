import { describe, it, expect } from 'vitest';
import {
  validateUsername,
  normalizeUsername,
  usernameErrorCopy,
  RESERVED_USERNAMES,
} from '../src/lib/username';

describe('normalizeUsername', () => {
  it('lowercases and trims', () => {
    expect(normalizeUsername('  Alice  ')).toBe('alice');
    expect(normalizeUsername('Bob_Smith')).toBe('bob_smith');
  });
});

describe('validateUsername', () => {
  it('accepts valid usernames', () => {
    expect(validateUsername('alice')).toBe('ok');
    expect(validateUsername('bob_smith')).toBe('ok');
    expect(validateUsername('user.name')).toBe('ok');
    expect(validateUsername('abc123')).toBe('ok');
  });

  it('rejects too-short usernames', () => {
    expect(validateUsername('a')).toBe('too-short');
    expect(validateUsername('ab')).toBe('too-short');
  });

  it('rejects too-long usernames', () => {
    expect(validateUsername('a'.repeat(21))).toBe('too-long');
  });

  it('rejects invalid characters', () => {
    // Note: normalizeUsername lowercases first, so 'Alice' is accepted.
    expect(validateUsername('alice@home')).toBe('invalid-chars');
    expect(validateUsername('alice-smith')).toBe('invalid-chars');
    expect(validateUsername('alice smith')).toBe('invalid-chars');
    expect(validateUsername('alice!')).toBe('invalid-chars');
  });

  it('rejects edge punctuation', () => {
    expect(validateUsername('.alice')).toBe('edge-punct');
    expect(validateUsername('alice.')).toBe('edge-punct');
    expect(validateUsername('_alice')).toBe('edge-punct');
    expect(validateUsername('alice_')).toBe('edge-punct');
  });

  it('rejects consecutive punctuation', () => {
    expect(validateUsername('al..ice')).toBe('consecutive-punct');
    expect(validateUsername('al__ice')).toBe('consecutive-punct');
    expect(validateUsername('al._ice')).toBe('consecutive-punct');
  });

  it('rejects reserved names', () => {
    expect(validateUsername('admin')).toBe('reserved');
    expect(validateUsername('support')).toBe('reserved');
    expect(validateUsername('offlinesms')).toBe('reserved');
    expect(validateUsername('ROOT')).toBe('reserved');           // normalized to root
  });

  it('reserved set is non-empty', () => {
    expect(RESERVED_USERNAMES.size).toBeGreaterThan(0);
  });
});

describe('usernameErrorCopy', () => {
  it('returns null for ok', () => {
    expect(usernameErrorCopy('ok')).toBeNull();
  });

  it('returns a non-empty string for every error code', () => {
    const codes = ['too-short', 'too-long', 'invalid-chars', 'edge-punct', 'consecutive-punct', 'reserved'] as const;
    for (const c of codes) {
      const copy = usernameErrorCopy(c);
      expect(copy).not.toBeNull();
      expect(typeof copy).toBe('string');
      expect(copy!.length).toBeGreaterThan(0);
    }
  });
});
