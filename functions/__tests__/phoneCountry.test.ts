import { describe, it, expect } from 'vitest';
import { normalizePhoneAndCountry } from '../src/lib/phoneCountry';

describe('normalizePhoneAndCountry — country detection', () => {
  it('detects Palestine (PS) from E.164', () => {
    const r = normalizePhoneAndCountry('+970599123456');
    expect(r.countryCode).toBe('PS');
    expect(r.isValid).toBe(true);
    expect(r.e164).toBe('+970599123456');
  });

  it('detects Israel (IL) from E.164', () => {
    const r = normalizePhoneAndCountry('+972501234567');
    expect(r.countryCode).toBe('IL');
    expect(r.isValid).toBe(true);
    expect(r.e164).toBe('+972501234567');
  });

  it('detects Jordan (JO) from E.164', () => {
    const r = normalizePhoneAndCountry('+962790123456');
    expect(r.countryCode).toBe('JO');
    expect(r.isValid).toBe(true);
  });

  it('detects Egypt (EG) from E.164', () => {
    const r = normalizePhoneAndCountry('+201001234567');
    expect(r.countryCode).toBe('EG');
    expect(r.isValid).toBe(true);
  });
});

describe('normalizePhoneAndCountry — messy / national input', () => {
  it('normalizes messy formatting to E.164', () => {
    const r = normalizePhoneAndCountry('+970 (59) 912-3456');
    expect(r.e164).toBe('+970599123456');
    expect(r.countryCode).toBe('PS');
    expect(r.isValid).toBe(true);
  });

  it('uses defaultCountry for national-format (non-E.164) input', () => {
    const r = normalizePhoneAndCountry('0599123456', 'PS');
    expect(r.countryCode).toBe('PS');
    expect(r.e164).toBe('+970599123456');
    expect(r.isValid).toBe(true);
  });

  it('national-format without defaultCountry is not detectable', () => {
    const r = normalizePhoneAndCountry('0599123456');
    expect(r.isValid).toBe(false);
    expect(r.countryCode).toBeNull();
  });
});

describe('normalizePhoneAndCountry — invalid input', () => {
  it('rejects empty / whitespace', () => {
    expect(normalizePhoneAndCountry('').isValid).toBe(false);
    expect(normalizePhoneAndCountry('   ').isValid).toBe(false);
    expect(normalizePhoneAndCountry('').reason).toBe('empty');
  });

  it('rejects non-numeric garbage', () => {
    const r = normalizePhoneAndCountry('not-a-phone');
    expect(r.isValid).toBe(false);
    expect(r.countryCode).toBeNull();
  });

  it('rejects too-short / implausible numbers', () => {
    expect(normalizePhoneAndCountry('+1').isValid).toBe(false);
    expect(normalizePhoneAndCountry('12345').isValid).toBe(false);
  });

  it('marks a wrong-length PS number invalid (libphonenumber validation, not just prefix)', () => {
    const r = normalizePhoneAndCountry('+9705991'); // too short for PS mobile
    expect(r.isValid).toBe(false);
  });
});
