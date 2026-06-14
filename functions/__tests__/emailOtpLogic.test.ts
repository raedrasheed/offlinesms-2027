import { describe, it, expect } from 'vitest';
import {
  normalizeEmail, isValidEmail, emailKey, EMAIL_OTP_TTL_MS,
} from '../src/auth/emailOtpLogic';
import {
  generateOtp, newSalt, hashOtp, verifyOtpHash, isOtpExpired,
  canResend, nextSendWindow, OTP_CODE_LENGTH, OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS, OTP_MAX_PER_HOUR,
} from '../src/auth/otpLogic';

describe('normalizeEmail', () => {
  it('lowercases and trims valid addresses', () => {
    expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    expect(normalizeEmail('a.b+tag@sub.example.io')).toBe('a.b+tag@sub.example.io');
  });
  it('rejects implausible input', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail('missing@domain')).toBeNull();   // no TLD
    expect(normalizeEmail('a b@example.com')).toBeNull();   // space
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(12345 as unknown)).toBeNull();
    expect(normalizeEmail(('x@' + 'a'.repeat(260) + '.com'))).toBeNull(); // too long
  });
  it('isValidEmail agrees with normalizeEmail', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });
});

describe('emailKey', () => {
  it('is a stable sha256 hex id that does not contain the address', () => {
    const k = emailKey('user@example.com');
    expect(k).toMatch(/^[a-f0-9]{64}$/);
    expect(k).not.toContain('user');
    expect(k).not.toContain('@');
    expect(emailKey('user@example.com')).toBe(k); // deterministic
  });
  it('differs per address', () => {
    expect(emailKey('a@example.com')).not.toBe(emailKey('b@example.com'));
  });
});

describe('email OTP TTL', () => {
  it('is 10 minutes', () => {
    expect(EMAIL_OTP_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe('code generation / hashing (shared with phone)', () => {
  it('generates a 6-digit numeric code', () => {
    const code = generateOtp(OTP_CODE_LENGTH, () => 0.5);
    expect(code).toMatch(/^\d{6}$/);
  });
  it('stores only a salted hash — never the plaintext code', () => {
    const code = '482913';
    const salt = newSalt();
    const stored = hashOtp(code, salt);
    expect(stored).not.toContain(code);
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyOtpHash(code, salt, stored)).toBe(true);
    expect(verifyOtpHash('000000', salt, stored)).toBe(false);
  });
});

describe('verification edge cases (shared helpers)', () => {
  const now = 5_000_000;
  it('expired code is rejected', () => {
    expect(isOtpExpired(now - EMAIL_OTP_TTL_MS, now)).toBe(true);
    expect(isOtpExpired(now + 1, now)).toBe(false);
  });
  it('attempt cap is 5', () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });
  it('resend cooldown is 60s', () => {
    expect(OTP_RESEND_COOLDOWN_MS).toBe(60 * 1000);
    expect(canResend(now - 1, now)).toBe(false);
    expect(canResend(now - OTP_RESEND_COOLDOWN_MS, now)).toBe(true);
  });
  it('hourly rate limit blocks after the cap and resets after an hour', () => {
    const maxed = nextSendWindow(now, OTP_MAX_PER_HOUR, now + 1000);
    expect(maxed.allowed).toBe(false);
    const reset = nextSendWindow(now, OTP_MAX_PER_HOUR, now + 60 * 60 * 1000 + 1);
    expect(reset.allowed).toBe(true);
    expect(reset.count).toBe(1);
  });
});
