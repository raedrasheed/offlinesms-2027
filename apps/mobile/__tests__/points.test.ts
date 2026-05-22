import { describe, it, expect } from 'vitest';
import {
  canonicaliseType,
  getTransactionLabel,
  getTransactionIcon,
  formatPointsAmount,
} from '../src/lib/points.helpers';

describe('canonicaliseType', () => {
  it('maps known synonyms to canonical types', () => {
    expect(canonicaliseType('sms_spend')).toBe('sms_spend');
    expect(canonicaliseType('sms')).toBe('sms_spend');
    expect(canonicaliseType('reservation')).toBe('reservation');
    expect(canonicaliseType('reservation_release')).toBe('reservation_release');
    expect(canonicaliseType('release')).toBe('reservation_release');
    expect(canonicaliseType('refund')).toBe('refund');
    expect(canonicaliseType('purchase')).toBe('purchase');
    expect(canonicaliseType('transfer_in')).toBe('transfer_in');
    expect(canonicaliseType('transfer_out')).toBe('transfer_out');
    expect(canonicaliseType('admin_adjustment')).toBe('admin_adjustment');
  });

  it('falls back to "other" for unknown / empty inputs', () => {
    expect(canonicaliseType('')).toBe('other');
    expect(canonicaliseType(null)).toBe('other');
    expect(canonicaliseType(undefined)).toBe('other');
    expect(canonicaliseType('mystery_type')).toBe('other');
  });
});

describe('getTransactionLabel', () => {
  it('returns a label for every canonical type', () => {
    const types = ['sms_spend', 'reservation', 'reservation_release', 'refund', 'purchase', 'transfer_in', 'transfer_out', 'admin_adjustment', 'other'] as const;
    for (const t of types) {
      const label = getTransactionLabel(t);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('getTransactionIcon', () => {
  it('returns an icon for every canonical type', () => {
    const types = ['sms_spend', 'reservation', 'reservation_release', 'refund', 'purchase', 'transfer_in', 'transfer_out', 'admin_adjustment', 'other'] as const;
    for (const t of types) {
      const icon = getTransactionIcon(t);
      expect(typeof icon).toBe('string');
      expect(icon.length).toBeGreaterThan(0);
    }
  });
});

describe('formatPointsAmount', () => {
  it('prepends + for credits', () => {
    expect(formatPointsAmount(100, 'credit')).toMatch(/^\+/);
    expect(formatPointsAmount(100, 'credit')).toContain('100');
    expect(formatPointsAmount(100, 'credit')).toContain('pts');
  });

  it('prepends − for debits', () => {
    expect(formatPointsAmount(100, 'debit')).toMatch(/^−/);
    expect(formatPointsAmount(100, 'debit')).toContain('100');
  });

  it('always uses the absolute value', () => {
    expect(formatPointsAmount(-200, 'credit')).toContain('200');
    expect(formatPointsAmount(-200, 'credit')).not.toContain('-200');
    expect(formatPointsAmount(-200, 'debit')).toContain('200');
  });

  it('formats with locale separators on large numbers', () => {
    const out = formatPointsAmount(1234567, 'credit');
    expect(out).toContain('pts');
    // toLocaleString without args uses default English grouping in node:
    expect(out).toMatch(/1[,.   ]?234[,.   ]?567/);
  });
});
