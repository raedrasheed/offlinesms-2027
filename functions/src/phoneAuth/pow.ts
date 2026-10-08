// Proof-of-work admission for the public phone flow. Pure (node:crypto only).
//
// Why: native iOS/Android cannot produce App Check tokens on this stack yet
// (the app runs the Firebase web SDK; see docs/APP_CHECK.md), so there is no
// device attestation to require. A server-issued, single-use, destination-bound
// proof-of-work is a server-verifiable anti-automation step that works on every
// client today. It is a COST, not a proof of humanity: a well-resourced
// attacker can pay it. The quotas (session / installation / source /
// destination / global) remain the primary limiter; this makes each attempt
// cost CPU time and makes naive scripting pointless.
//
// Protocol:  digest = SHA-256("pow:v1:" + nonce + ":" + e164 + ":" + solution)
// valid iff digest has >= bits leading zero bits. The nonce is random, belongs
// to one pre-auth session, expires, and is rotated (consumed) on every request
// that reaches the proof check — so a proof can't be replayed or reused for a
// different destination.

import { createHash, randomBytes } from 'node:crypto';

export const POW_SOLUTION_RE = /^\d{1,16}$/;

export function newPowNonce(): string {
  return randomBytes(16).toString('hex');
}

export function powDigest(nonce: string, e164: string, solution: string): Buffer {
  return createHash('sha256').update(`pow:v1:${nonce}:${e164}:${solution}`).digest();
}

/** Number of leading zero bits in a digest. */
export function leadingZeroBits(buf: Uint8Array): number {
  let n = 0;
  for (const byte of buf) {
    if (byte === 0) { n += 8; continue; }
    return n + Math.clz32(byte) - 24;
  }
  return n;
}

export function verifyPow(nonce: string, e164: string, solution: unknown, bits: number): boolean {
  if (typeof solution !== 'string' || !POW_SOLUTION_RE.test(solution)) return false;
  return leadingZeroBits(powDigest(nonce, e164, solution)) >= bits;
}

/**
 * Adaptive difficulty: +2 bits once the sign-in budget for the hour is half
 * used, +4 at 90 % (capped). Each extra bit doubles the expected client work.
 */
export function adaptiveBits(base: number, max: number, usedThisHour: number, perHour: number): number {
  if (perHour <= 0) return Math.min(max, base + 4);
  const frac = usedThisHour / perHour;
  const extra = frac >= 0.9 ? 4 : frac >= 0.5 ? 2 : 0;
  return Math.min(max, base + extra);
}

/** Test/benchmark helper: brute-force a solution (never used by the server). */
export function solvePow(nonce: string, e164: string, bits: number, start = 0, limit = 1 << 26): string | null {
  for (let i = start; i < start + limit; i++) {
    const s = String(i);
    if (leadingZeroBits(powDigest(nonce, e164, s)) >= bits) return s;
  }
  return null;
}
