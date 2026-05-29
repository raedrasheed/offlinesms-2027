import { describe, it, expect } from 'vitest';
import {
  normalizeE164, phoneKey, generateOtp, newSalt, hashOtp, verifyOtpHash,
  isOtpExpired, canResend, nextSendWindow,
  OTP_CODE_LENGTH, OTP_RESEND_COOLDOWN_MS, OTP_MAX_PER_HOUR,
} from '../src/auth/otpLogic';

describe('normalizeE164', () => {
  it('accepts plausible E.164 and strips formatting', () => {
    expect(normalizeE164('+972 59 123 4567')).toBe('+972591234567');
    expect(normalizeE164('+1 (415) 555-0188')).toBe('+14155550188');
  });
  it('rejects implausible input', () => {
    expect(normalizeE164('0591234567')).toBeNull(); // no country code
    expect(normalizeE164('+0123')).toBeNull();       // leading 0 / too short
    expect(normalizeE164(12345 as unknown)).toBeNull();
  });
});

describe('phoneKey + otp generation', () => {
  it('phoneKey is digits only', () => expect(phoneKey('+972591234567')).toBe('972591234567'));
  it('generateOtp is N digits', () => {
    const code = generateOtp(OTP_CODE_LENGTH, () => 0.42);
    expect(code).toHaveLength(OTP_CODE_LENGTH);
    expect(code).toMatch(/^\d{6}$/);
  });
});

describe('hash + verify (salted, constant-time)', () => {
  it('verifies the right code and rejects the wrong one', () => {
    const salt = newSalt();
    const h = hashOtp('123456', salt);
    expect(verifyOtpHash('123456', salt, h)).toBe(true);
    expect(verifyOtpHash('654321', salt, h)).toBe(false);
    expect(verifyOtpHash('123456', newSalt(), h)).toBe(false); // different salt
  });
});

describe('expiry + resend cooldown', () => {
  const now = 1_000_000;
  it('expiry', () => {
    expect(isOtpExpired(now - 1, now)).toBe(true);
    expect(isOtpExpired(now + 1, now)).toBe(false);
  });
  it('resend cooldown', () => {
    expect(canResend(null, now)).toBe(true);
    expect(canResend(now - 1, now)).toBe(false);
    expect(canResend(now - OTP_RESEND_COOLDOWN_MS, now)).toBe(true);
  });
});

describe('per-hour send window', () => {
  const now = 10_000_000;
  it('counts within the window and resets after an hour', () => {
    expect(nextSendWindow(null, 0, now)).toEqual({ allowed: true, count: 1, windowStartMs: now });
    expect(nextSendWindow(now, 1, now + 1000)).toEqual({ allowed: true, count: 2, windowStartMs: now });
    const maxed = nextSendWindow(now, OTP_MAX_PER_HOUR, now + 1000);
    expect(maxed.allowed).toBe(false);
    const reset = nextSendWindow(now, OTP_MAX_PER_HOUR, now + 60 * 60 * 1000 + 1);
    expect(reset).toEqual({ allowed: true, count: 1, windowStartMs: now + 60 * 60 * 1000 + 1 });
  });
});
