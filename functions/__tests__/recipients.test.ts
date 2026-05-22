import { describe, it, expect } from 'vitest';
import { canonicalAudience, maskPhone, filterByAudience } from '../src/sms/recipients';

describe('canonicalAudience', () => {
  it('returns canonical names unchanged', () => {
    expect(canonicalAudience('everyone')).toBe('everyone');
    expect(canonicalAudience('unread_only')).toBe('unread_only');
    expect(canonicalAudience('undelivered_only')).toBe('undelivered_only');
  });

  it('maps legacy short names to canonical names', () => {
    expect(canonicalAudience('unread')).toBe('unread_only');
    expect(canonicalAudience('undelivered')).toBe('undelivered_only');
  });
});

describe('maskPhone (sms helper)', () => {
  it('returns empty for empty input', () => {
    expect(maskPhone('')).toBe('');
  });

  it('keeps short numbers as-is', () => {
    expect(maskPhone('12345')).toBe('12345');
  });

  it('masks the middle of longer numbers', () => {
    const out = maskPhone('+14155550100');
    expect(out).toContain('+141');
    expect(out).toContain('100');
    expect(out).toContain('•');
    expect(out).not.toContain('5550');
  });
});

describe('filterByAudience', () => {
  const participantUids = ['u-alice', 'u-bob', 'u-carol', 'u-sender'];
  const sender = 'u-sender';

  it('everyone returns all except sender', () => {
    const { candidates } = filterByAudience('everyone', participantUids, sender, new Map());
    expect(candidates.map(c => c.uid).sort()).toEqual(['u-alice', 'u-bob', 'u-carol']);
  });

  it('unread_only excludes read/viewed/played statuses', () => {
    const receipts = new Map<string, { status?: string }>([
      ['u-alice', { status: 'read' }],
      ['u-bob',   { status: 'pending' }],
      ['u-carol', { status: 'viewed' }],
    ]);
    const { candidates } = filterByAudience('unread_only', participantUids, sender, receipts);
    expect(candidates.map(c => c.uid)).toEqual(['u-bob']);
  });

  it('unread_only includes users with no receipt', () => {
    const receipts = new Map<string, { status?: string }>([
      ['u-alice', { status: 'read' }],
    ]);
    const { candidates } = filterByAudience('unread_only', participantUids, sender, receipts);
    expect(candidates.map(c => c.uid).sort()).toEqual(['u-bob', 'u-carol']);
  });

  it('undelivered_only includes pending/failed and missing receipts only', () => {
    const receipts = new Map<string, { status?: string }>([
      ['u-alice', { status: 'delivered' }],
      ['u-bob',   { status: 'pending' }],
      ['u-carol', { status: 'failed' }],
    ]);
    const { candidates } = filterByAudience('undelivered_only', participantUids, sender, receipts);
    expect(candidates.map(c => c.uid).sort()).toEqual(['u-bob', 'u-carol']);
  });

  it('never includes the sender even when status missing', () => {
    const { candidates } = filterByAudience('everyone', participantUids, sender, new Map());
    expect(candidates.find(c => c.uid === sender)).toBeUndefined();
  });

  it('returns empty list when only sender is a participant', () => {
    const { candidates } = filterByAudience('everyone', [sender], sender, new Map());
    expect(candidates).toEqual([]);
  });
});
