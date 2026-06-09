import { describe, it, expect } from 'vitest';
import { toExternalMemberView, type ExternalMemberRow } from '../../src/localdb/repositories/externalMembersModel';

const baseRow = (over: Partial<ExternalMemberRow> = {}): ExternalMemberRow => ({
  id: 'ext_1',
  conversation_id: 'g1',
  contact_id: '972591234567',
  display_name: 'Hashem',
  phone_e164: '+972591234567',
  normalized_phone: '972591234567',
  is_registered: 0,
  linked_uid: null,
  pending: 0,
  updated_at: 123,
  ...over,
});

describe('toExternalMemberView', () => {
  it('maps an unregistered, synced row', () => {
    expect(toExternalMemberView(baseRow())).toEqual({
      contactId: '972591234567',
      displayName: 'Hashem',
      phoneE164: '+972591234567',
      normalizedPhone: '972591234567',
      isRegistered: false,
      linkedUid: null,
      pending: false,
    });
  });

  it('maps a registered + linked row', () => {
    const v = toExternalMemberView(baseRow({ is_registered: 1, linked_uid: 'u-h' }));
    expect(v.isRegistered).toBe(true);
    expect(v.linkedUid).toBe('u-h');
  });

  it('maps a pending (offline-queued) row', () => {
    expect(toExternalMemberView(baseRow({ pending: 1 })).pending).toBe(true);
  });

  it('tolerates null text columns', () => {
    const v = toExternalMemberView(baseRow({ display_name: null, phone_e164: null, normalized_phone: null }));
    expect(v.displayName).toBe('');
    expect(v.phoneE164).toBe('');
    expect(v.normalizedPhone).toBe('');
  });
});
