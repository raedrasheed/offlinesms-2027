import { describe, it, expect } from 'vitest';
import { normalizePhoneToE164, isE164, phoneDigits, maskPhone } from '../src/lib/phone';

describe('normalizePhoneToE164', () => {
  it('accepts a clean E.164 number', () => {
    expect(normalizePhoneToE164('+972591234567')).toBe('+972591234567');
  });
  it('strips spaces, parens, hyphens, dots', () => {
    expect(normalizePhoneToE164('+972 (59) 123-45.67')).toBe('+972591234567');
  });
  it('prepends a default dial code when input has no +', () => {
    expect(normalizePhoneToE164('591234567', '+970')).toBe('+970591234567');
  });
  it('drops a national trunk 0 when using a default dial code', () => {
    expect(normalizePhoneToE164('0591234567', '+970')).toBe('+970591234567');
  });
  it('returns null for a bare national number with no country context', () => {
    expect(normalizePhoneToE164('0591234567')).toBeNull();
  });
  it('rejects empty / junk input', () => {
    expect(normalizePhoneToE164('')).toBeNull();
    expect(normalizePhoneToE164('abc')).toBeNull();
    expect(normalizePhoneToE164('+')).toBeNull();
  });
  it('rejects a leading-zero country code', () => {
    expect(normalizePhoneToE164('+0591234567')).toBeNull();
  });
  it('rejects too-short and too-long numbers', () => {
    expect(normalizePhoneToE164('+12345')).toBeNull();
    expect(normalizePhoneToE164('+1234567890123456')).toBeNull();
  });
  it('is idempotent on an already-normalized number', () => {
    const once = normalizePhoneToE164('+14155550123');
    expect(normalizePhoneToE164(once!)).toBe(once);
  });
});

describe('isE164 / phoneDigits / maskPhone', () => {
  it('isE164 validates format', () => {
    expect(isE164('+14155550123')).toBe(true);
    expect(isE164('14155550123')).toBe(false);
  });
  it('phoneDigits strips to digits', () => {
    expect(phoneDigits('+972 59-123 4567')).toBe('972591234567');
  });
  it('maskPhone keeps last 4', () => {
    expect(maskPhone('+972591234567')).toBe('••• 4567');
    expect(maskPhone('+12')).toBe('•••');
  });
});
