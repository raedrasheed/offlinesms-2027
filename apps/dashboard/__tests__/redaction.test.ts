import { describe, it, expect } from 'vitest';
import { maskPhone, maskEmail, safeDate } from '../lib/redaction';

describe('maskPhone', () => {
  it('returns em dash for null/undefined/empty', () => {
    expect(maskPhone(null)).toBe('—');
    expect(maskPhone(undefined)).toBe('—');
    expect(maskPhone('')).toBe('—');
  });

  it('returns dot placeholder for too-short input', () => {
    expect(maskPhone('12')).toBe('•••');
  });

  it('masks all but the last 4 digits', () => {
    expect(maskPhone('+14155550100')).toMatch(/^\+•+ 0100$/);
    expect(maskPhone('14155550100')).toMatch(/^\+•+ 0100$/);
  });

  it('strips non-digit characters', () => {
    expect(maskPhone('+1 (415) 555-0100')).toMatch(/^\+•+ 0100$/);
  });

  it('never returns the raw last-4 in the masked portion', () => {
    const out = maskPhone('+14155550100');
    expect(out).not.toContain('5550');
    expect(out).toContain('0100');
  });
});

describe('maskEmail', () => {
  it('returns em dash for empty input', () => {
    expect(maskEmail(null)).toBe('—');
    expect(maskEmail(undefined)).toBe('—');
    expect(maskEmail('')).toBe('—');
  });

  it('returns full email for privileged role', () => {
    expect(maskEmail('alice@example.com', 'super_admin')).toBe('alice@example.com');
    expect(maskEmail('alice@example.com', 'legacy_admin')).toBe('alice@example.com');
    expect(maskEmail('alice@example.com', 'support_agent')).toBe('alice@example.com');
  });

  it('masks email for non-privileged role', () => {
    const masked = maskEmail('alice@example.com', 'auditor');
    expect(masked).toContain('@example.com');
    expect(masked).not.toContain('alice');
  });

  it('masks email when no role provided', () => {
    const masked = maskEmail('alice@example.com');
    expect(masked).toContain('@example.com');
    expect(masked.startsWith('a')).toBe(true);
    expect(masked).not.toContain('alice@');
  });

  it('handles short local parts safely', () => {
    expect(maskEmail('ab@x.io')).toBe('a•@x.io');
  });

  it('handles malformed email without @', () => {
    expect(maskEmail('not-an-email')).toBe('•••@••');
  });
});

describe('safeDate', () => {
  it('returns em dash for null/undefined', () => {
    expect(safeDate(null)).toBe('—');
    expect(safeDate(undefined)).toBe('—');
  });

  it('returns em dash for object without toDate', () => {
    expect(safeDate({})).toBe('—');
  });

  it('formats a Firestore-like timestamp with toDate()', () => {
    const ts = { toDate: () => new Date('2026-05-22T10:30:00Z') };
    const out = safeDate(ts);
    expect(out).not.toBe('—');
    expect(out).toContain('2026');
  });

  it('formats a _seconds Firestore export shape', () => {
    const ts = { _seconds: 1716372600 }; // 2024-05-22 10:30:00 UTC
    const out = safeDate(ts);
    expect(out).not.toBe('—');
  });

  it('returns em dash for invalid date', () => {
    const ts = { toDate: () => new Date('not-a-date') };
    expect(safeDate(ts)).toBe('—');
  });
});
