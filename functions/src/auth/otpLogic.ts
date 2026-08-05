// Pure-ish OTP helpers (Phase 24 — OTP over relay). Code generation + hashing
// are deterministic and unit-testable; no Firestore here.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const OTP_TTL_MS = 5 * 60 * 1000;          // code lifetime
export const OTP_MAX_ATTEMPTS = 5;                // verify attempts per code
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;  // min gap between sends
export const OTP_MAX_PER_HOUR = 5;                // sends per phone per hour
export const OTP_CODE_LENGTH = 6;

// App-review test account (Apple App Store / Google Play reviewers can't
// receive a real SMS). For this exact number no SMS is sent and verifyPhoneOtp
// accepts only TEST_PHONE_OTP. Keep this in sync with store review notes.
export const TEST_PHONE_E164 = '+970599999999';
export const TEST_PHONE_OTP = '123456';

/** True for the fixed App-review test phone number (compared in E.164 form). */
export function isTestPhone(e164: string): boolean {
  return e164 === TEST_PHONE_E164;
}

// Sign-in is restricted to the mobile prefixes the relay serves. The national
// (significant) number must start with one of these — for EVERY number. A
// number with no detectable country code, or whose national number starts with
// any other prefix, is "not supported" and rejected.
export const SIGNIN_ALLOWED_PREFIXES = ['59', '56'] as const;

/**
 * Is this phone allowed to sign in, given its ISO country and national number?
 *
 * The rule is intentionally strict (the system serves only 59/56 mobile
 * numbers): a usable country code is required AND the national significant
 * number must start with 59 or 56. Numbers without a country code (countryCode
 * null) or with any other prefix are not supported. Pure + unit-testable.
 */
export function isSupportedSignInNumber(countryCode: string | null | undefined, nationalNumber: string): boolean {
  if (!countryCode) return false;          // no country code → can't be a supported number
  if (!nationalNumber) return false;
  return SIGNIN_ALLOWED_PREFIXES.some(p => nationalNumber.startsWith(p));
}

/** Normalize to E.164 (or null if implausible). */
export function normalizeE164(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.replace(/[\s()\-.]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(trimmed)) return null;
  return trimmed;
}

/** Firestore-safe doc id for a phone (digits only). */
export function phoneKey(e164: string): string {
  return e164.replace(/\D/g, '');
}

/** Random numeric OTP. */
export function generateOtp(len = OTP_CODE_LENGTH, rnd: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < len; i++) out += Math.floor(rnd() * 10).toString();
  return out;
}

export function newSalt(): string {
  return randomBytes(16).toString('hex');
}

/** Salted SHA-256 of the code (never store the plaintext code). */
export function hashOtp(code: string, salt: string): string {
  return createHash('sha256').update(`${code}:${salt}`).digest('hex');
}

export function verifyOtpHash(code: string, salt: string, expectedHash: string): boolean {
  const actual = hashOtp(code, salt);
  if (actual.length !== expectedHash.length) return false;
  try { return timingSafeEqual(Buffer.from(actual), Buffer.from(expectedHash)); }
  catch { return false; }
}

export function isOtpExpired(expiresAtMs: number, nowMs: number): boolean {
  return expiresAtMs <= nowMs;
}

export function canResend(lastSentAtMs: number | null | undefined, nowMs: number): boolean {
  if (lastSentAtMs == null) return true;
  return nowMs - lastSentAtMs >= OTP_RESEND_COOLDOWN_MS;
}

/** Sends allowed in the rolling hour window; returns the next {count, windowStartMs}. */
export function nextSendWindow(
  windowStartMs: number | null | undefined, count: number | null | undefined, nowMs: number,
): { allowed: boolean; count: number; windowStartMs: number } {
  const start = windowStartMs ?? 0;
  const c = count ?? 0;
  if (nowMs - start >= 60 * 60 * 1000) return { allowed: true, count: 1, windowStartMs: nowMs };
  if (c >= OTP_MAX_PER_HOUR) return { allowed: false, count: c, windowStartMs: start };
  return { allowed: true, count: c + 1, windowStartMs: start };
}
