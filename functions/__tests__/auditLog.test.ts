import { describe, it, expect } from 'vitest';
import { redactPhone, redactEmail, sanitiseMetadata } from '../src/lib/auditLog';

describe('redactPhone', () => {
  it('returns null for null/undefined input', () => {
    expect(redactPhone(null)).toBeNull();
    expect(redactPhone(undefined)).toBeNull();
  });

  it('returns •• for too-short input', () => {
    expect(redactPhone('1')).toBe('••');
    expect(redactPhone('12')).toBe('••');
  });

  it('shows only the last two digits with dot-prefix', () => {
    const out = redactPhone('+14155550100');
    expect(out).toMatch(/^\+•+00$/);
    expect(out).not.toContain('5550');
  });

  it('strips non-digits before redacting', () => {
    const out = redactPhone('+1 (415) 555-0100');
    expect(out).toMatch(/^\+•+00$/);
  });
});

describe('redactEmail', () => {
  it('returns null for null/undefined input', () => {
    expect(redactEmail(null)).toBeNull();
    expect(redactEmail(undefined)).toBeNull();
  });

  it('keeps only the domain', () => {
    expect(redactEmail('alice@example.com')).toBe('•••@example.com');
  });

  it('handles malformed emails safely', () => {
    expect(redactEmail('no-at-sign')).toBe('••@••');
  });
});

describe('sanitiseMetadata', () => {
  it('returns empty object for undefined input', () => {
    expect(sanitiseMetadata(undefined)).toEqual({});
  });

  it('drops forbidden top-level keys', () => {
    const result = sanitiseMetadata({
      password: 'p4ssw0rd',
      token: 'xyz',
      otp: '123456',
      secret: 'shh',
      phoneNumber: '+1234567890',
      messageText: 'private',
      safe: 'kept',
    });
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('otp');
    expect(result).not.toHaveProperty('secret');
    expect(result).not.toHaveProperty('phoneNumber');
    expect(result).not.toHaveProperty('messageText');
    expect(result.safe).toBe('kept');
  });

  it('clamps strings longer than 200 chars', () => {
    const long = 'x'.repeat(500);
    const result = sanitiseMetadata({ note: long });
    expect((result.note as string).length).toBe(201); // 200 + '…'
    expect((result.note as string).endsWith('…')).toBe(true);
  });

  it('preserves numbers and booleans', () => {
    expect(sanitiseMetadata({ count: 42, ok: true, fail: false })).toEqual({
      count: 42,
      ok: true,
      fail: false,
    });
  });

  it('caps arrays at 16 items', () => {
    const big = Array.from({ length: 100 }, (_, i) => i);
    const result = sanitiseMetadata({ items: big });
    expect((result.items as number[]).length).toBe(16);
  });

  it('flattens nested objects one level deep with dot keys', () => {
    const result = sanitiseMetadata({
      target: { id: 'x123', count: 5 },
    });
    expect(result['target.id']).toBe('x123');
    expect(result['target.count']).toBe(5);
  });

  it('drops forbidden keys inside nested objects', () => {
    const result = sanitiseMetadata({
      target: { id: 'x123', password: 'secret' },
    });
    expect(result['target.id']).toBe('x123');
    expect(result['target.password']).toBeUndefined();
  });

  it('preserves null values', () => {
    expect(sanitiseMetadata({ foo: null })).toEqual({ foo: null });
  });
});
