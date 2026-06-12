import { describe, it, expect } from 'vitest';
import {
  API_KEY_PREFIX, generateApiKey, hashApiKey, hashesMatch,
  isApiKeyFormat, pickApiKeyStatusRow,
} from '../lib/orgMessagingKeys';

describe('generateApiKey', () => {
  it('produces the documented format: offmsg_live_<43 base64url chars>', () => {
    const { raw } = generateApiKey();
    expect(raw.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(isApiKeyFormat(raw)).toBe(true);
    expect(raw.length).toBe(API_KEY_PREFIX.length + 43);
  });

  it('is unique across generations', () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().raw));
    expect(keys.size).toBe(50);
  });

  it('returns the matching hash for the raw key — and never the raw inside the hash', () => {
    const { raw, hash } = generateApiKey();
    expect(hash).toBe(hashApiKey(raw));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);      // sha256 hex — what gets stored
    expect(hash).not.toContain(raw);
    expect(hash.includes(API_KEY_PREFIX)).toBe(false);
  });
});

describe('hashApiKey / hashesMatch', () => {
  it('is deterministic and key-sensitive', () => {
    expect(hashApiKey('offmsg_live_a')).toBe(hashApiKey('offmsg_live_a'));
    expect(hashApiKey('offmsg_live_a')).not.toBe(hashApiKey('offmsg_live_b'));
  });
  it('hashesMatch compares correctly', () => {
    const h = hashApiKey('x');
    expect(hashesMatch(h, hashApiKey('x'))).toBe(true);
    expect(hashesMatch(h, hashApiKey('y'))).toBe(false);
    expect(hashesMatch(h, 'short')).toBe(false);
  });
});

describe('isApiKeyFormat', () => {
  it('accepts only well-formed keys', () => {
    expect(isApiKeyFormat(generateApiKey().raw)).toBe(true);
    expect(isApiKeyFormat('offmsg_live_short')).toBe(false);
    expect(isApiKeyFormat('offmsg_test_' + 'a'.repeat(43))).toBe(false);
    expect(isApiKeyFormat('Bearer offmsg_live_' + 'a'.repeat(43))).toBe(false);
    expect(isApiKeyFormat('')).toBe(false);
  });
});

describe('pickApiKeyStatusRow (the only shape dashboard reads expose)', () => {
  const ts = (ms: number) => ({ toMillis: () => ms, toDate: () => new Date(ms) });

  it('returns null with no keys', () => {
    expect(pickApiKeyStatusRow([])).toBeNull();
  });

  it('prefers the active key over newer revoked ones', () => {
    const row = pickApiKeyStatusRow([
      { id: 'old-active', data: { status: 'active', keyHash: 'H1', createdAt: ts(100) } },
      { id: 'new-revoked', data: { status: 'revoked', keyHash: 'H2', createdAt: ts(200), revokedAt: ts(300) } },
    ]);
    expect(row?.keyId).toBe('old-active');
    expect(row?.status).toBe('active');
  });

  it('falls back to the newest key when none is active (history visible)', () => {
    const row = pickApiKeyStatusRow([
      { id: 'k1', data: { status: 'revoked', keyHash: 'H1', createdAt: ts(100) } },
      { id: 'k2', data: { status: 'revoked', keyHash: 'H2', createdAt: ts(500), revokedAt: ts(600) } },
    ]);
    expect(row?.keyId).toBe('k2');
    expect(row?.status).toBe('revoked');
    expect(row?.revokedAt).not.toBe('');
  });

  it('NEVER exposes keyHash (or any raw secret material)', () => {
    const row = pickApiKeyStatusRow([
      { id: 'k1', data: { status: 'active', keyHash: 'super-secret-hash', createdAt: ts(100), lastUsedAt: ts(200) } },
    ])!;
    expect(Object.keys(row).sort()).toEqual(['createdAt', 'keyId', 'lastUsedAt', 'revokedAt', 'status']);
    expect(JSON.stringify(row)).not.toContain('super-secret-hash');
  });
});
