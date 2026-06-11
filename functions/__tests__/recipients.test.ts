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

import {
  isExternalRecipientId, externalRecipientId, loadExternalEligibles, EXTERNAL_PREFIX,
} from '../src/sms/recipients';

describe('external recipient ids', () => {
  it('externalRecipientId prefixes the digits', () => {
    expect(externalRecipientId('972591234567')).toBe(EXTERNAL_PREFIX + '972591234567');
  });
  it('isExternalRecipientId detects the prefix', () => {
    expect(isExternalRecipientId('ext:972591234567')).toBe(true);
    expect(isExternalRecipientId('uid-abc')).toBe(false);
  });
});

// Minimal fake of the Firestore reads loadExternalEligibles performs:
//   db.collection('conversations').doc(id).collection('externalMembers').get()
function fakeDb(externalDocs: Array<Record<string, unknown>>) {
  const snap = { empty: externalDocs.length === 0, docs: externalDocs.map(d => ({ data: () => d })) };
  return {
    collection: () => ({
      doc: () => ({ collection: () => ({ get: async () => snap }) }),
    }),
  } as any;
}

describe('loadExternalEligibles (SMS recipient calculation includes external contacts)', () => {
  it('includes an unregistered external contact', async () => {
    const db = fakeDb([
      { phoneE164: '+972591234567', normalizedPhone: '972591234567', displayName: 'Hashem', isRegistered: false, linkedUid: null },
    ]);
    const out = await loadExternalEligibles(db, 'g1', ['u-a'], new Set());
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ uid: 'ext:972591234567', phone: '+972591234567', displayName: 'Hashem' });
  });

  it('skips an external contact already linked to a participant (in-app path)', async () => {
    const db = fakeDb([
      { phoneE164: '+972591234567', normalizedPhone: '972591234567', displayName: 'Hashem', isRegistered: true, linkedUid: 'u-h' },
    ]);
    const out = await loadExternalEligibles(db, 'g1', ['u-a', 'u-h'], new Set());
    expect(out).toHaveLength(0);
  });

  it('dedupes a phone already covered by a registered recipient', async () => {
    const db = fakeDb([
      { phoneE164: '+972591234567', normalizedPhone: '972591234567', displayName: 'Dup', isRegistered: false, linkedUid: null },
    ]);
    const out = await loadExternalEligibles(db, 'g1', ['u-a'], new Set(['+972591234567']));
    expect(out).toHaveLength(0);
  });

  it('dedupes duplicate phones within the external set', async () => {
    const db = fakeDb([
      { phoneE164: '+972591234567', normalizedPhone: '972591234567', displayName: 'A', isRegistered: false, linkedUid: null },
      { phoneE164: '+972591234567', normalizedPhone: '972591234567', displayName: 'B', isRegistered: false, linkedUid: null },
    ]);
    const out = await loadExternalEligibles(db, 'g1', ['u-a'], new Set());
    expect(out).toHaveLength(1);
  });
});
