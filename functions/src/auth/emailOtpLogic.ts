// Pure email-OTP helpers (mirrors otpLogic for phone). Normalization, validation
// and the Firestore doc key are deterministic and unit-testable; no Firestore or
// crypto-of-the-code here — code generation/hashing/rate-limits are reused from
// ./otpLogic so the two channels share one battle-tested implementation.

import { createHash } from 'node:crypto';

// Email codes live a little longer than SMS (inbox latency, spam folders).
export const EMAIL_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Simple, conservative email shape check (full RFC 5322 is intentionally avoided;
// the real proof of validity is that the code is delivered and entered).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize to a lowercased, trimmed address (or null if implausible). */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed.length > 254) return null;
  if (!EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

export function isValidEmail(input: unknown): boolean {
  return normalizeEmail(input) !== null;
}

/**
 * Firestore-safe doc id for an email. Hashed (SHA-256) so the address is not
 * exposed as a document id and so any character is safe in the key.
 * Callers must pass an already-normalized address.
 */
export function emailKey(normalizedEmail: string): string {
  return createHash('sha256').update(normalizedEmail).digest('hex');
}
