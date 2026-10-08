import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { sha256, leadingZeroBits, solvePow } from '../src/lib/sha256';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const ref = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('pure-TS sha256 matches node:crypto', () => {
  it('known vectors and boundary lengths', () => {
    const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(1000),
      'pow:v1:0123456789abcdef0123456789abcdef:+970599123456:12345', 'مرحبا 👋 é'];
    for (const s of inputs) expect(hex(sha256(s)), JSON.stringify(s).slice(0, 30)).toBe(ref(s));
  });
  it('random strings', () => {
    for (let i = 0; i < 300; i++) {
      const s = Math.random().toString(36).repeat(1 + (i % 7)) + i;
      expect(hex(sha256(s))).toBe(ref(s));
    }
  });
});

describe('proof-of-work solver', () => {
  it('finds a solution the server-side check accepts', async () => {
    const nonce = 'ab'.repeat(16);
    const sol = await solvePow(nonce, '+970599123456', 12);
    const digest = createHash('sha256').update(`pow:v1:${nonce}:+970599123456:${sol}`).digest();
    expect(leadingZeroBits(digest)).toBeGreaterThanOrEqual(12);
  });
  it('can be aborted', async () => {
    await expect(solvePow('cd'.repeat(16), '+970599123456', 40, { chunk: 10, signal: { aborted: true } })).rejects.toThrow('pow-aborted');
  });
});
