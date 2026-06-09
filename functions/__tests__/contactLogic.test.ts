import { describe, it, expect } from 'vitest';
import {
  phoneContactId, externalMemberId,
  newPhoneContactDoc, newExternalMemberDoc, cleanDisplayName,
} from '../src/contacts/contactLogic';

describe('phoneContactId (dedupe per owner)', () => {
  it('is deterministic for the same owner + number', () => {
    expect(phoneContactId('u1', '+972591234567')).toBe('u1_972591234567');
    expect(phoneContactId('u1', '+972591234567')).toBe(phoneContactId('u1', '+972591234567'));
  });
  it('differs by owner', () => {
    expect(phoneContactId('u1', '+972591234567')).not.toBe(phoneContactId('u2', '+972591234567'));
  });
});

describe('externalMemberId (dedupe per group, owner-independent)', () => {
  it('is the phone digits regardless of who adds it', () => {
    expect(externalMemberId('+972591234567')).toBe('972591234567');
  });
  it('two different admins adding the same number collide on one id', () => {
    expect(externalMemberId('+972 59 123 4567')).toBe(externalMemberId('+972591234567'));
  });
});

describe('newPhoneContactDoc', () => {
  it('builds an unregistered contact when no linkedUid', () => {
    const d = newPhoneContactDoc({ ownerUid: 'u1', displayName: '  Sara  ', e164: '+972591234567' });
    expect(d).toMatchObject({
      contactId: 'u1_972591234567', ownerUid: 'u1', organizationId: null,
      displayName: 'Sara', phoneE164: '+972591234567', normalizedPhone: '972591234567',
      isRegistered: false, linkedUid: null,
    });
  });
  it('marks registered when linkedUid present', () => {
    const d = newPhoneContactDoc({ ownerUid: 'u1', displayName: 'Sara', e164: '+972591234567', linkedUid: 'u9' });
    expect(d.isRegistered).toBe(true);
    expect(d.linkedUid).toBe('u9');
  });
});

describe('newExternalMemberDoc', () => {
  it('carries the owning contact ref + addedBy and registration state', () => {
    const d = newExternalMemberDoc({ contactId: 'u1_972591234567', displayName: 'Sara', e164: '+972591234567', addedByUid: 'u1' });
    expect(d).toMatchObject({
      contactId: 'u1_972591234567', displayName: 'Sara', phoneE164: '+972591234567',
      normalizedPhone: '972591234567', isRegistered: false, linkedUid: null, addedByUid: 'u1',
    });
  });
});

describe('cleanDisplayName', () => {
  it('trims and accepts a normal name', () => {
    expect(cleanDisplayName('  Hashem Nabil ')).toBe('Hashem Nabil');
  });
  it('rejects empty / too long / non-string', () => {
    expect(cleanDisplayName('')).toBeNull();
    expect(cleanDisplayName('   ')).toBeNull();
    expect(cleanDisplayName('x'.repeat(81))).toBeNull();
    expect(cleanDisplayName(42 as unknown)).toBeNull();
  });
});
