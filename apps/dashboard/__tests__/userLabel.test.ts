import { describe, it, expect } from 'vitest';
import {
  isExternalId, looksLikeUid, nameInfoFrom, userInitial, userLabel,
  PHONE_CONTACT_LABEL, UNKNOWN_USER_LABEL,
} from '../lib/userLabel';

const UID = 'CjEJcDq81LmZ0pQ2xYzA';

describe('userLabel', () => {
  it('displayName → @username → snapshot → "Unknown user"', () => {
    expect(userLabel({ displayName: 'Sara', username: 'sara' }, { uid: UID })).toBe('Sara');
    expect(userLabel({ displayName: null, username: 'sara' }, { uid: UID })).toBe('@sara');
    expect(userLabel(null, { uid: UID, snapshot: 'Sara S.' })).toBe('Sara S.');
    expect(userLabel(undefined, { uid: UID })).toBe(UNKNOWN_USER_LABEL);
  });

  it('never uses the uid or a uid fragment as the label', () => {
    expect(userLabel({ displayName: UID }, { uid: UID })).toBe(UNKNOWN_USER_LABEL);
    expect(userLabel(null, { uid: UID, snapshot: UID.slice(0, 6) })).toBe(UNKNOWN_USER_LABEL);
  });

  it('labels phone-only external ids as phone contacts', () => {
    expect(isExternalId('ext:970591234567')).toBe(true);
    expect(userLabel(null, { uid: 'ext:970591234567' })).toBe(PHONE_CONTACT_LABEL);
    expect(userLabel(null, { uid: 'ext:970591234567', snapshot: 'Mum' })).toBe('Mum');
  });

  it('userInitial never derives from a uid', () => {
    expect(userInitial('Sara')).toBe('S');
    expect(userInitial('@sara')).toBe('S');
    expect(userInitial(UNKNOWN_USER_LABEL)).toBe('?');
  });
});

describe('nameInfoFrom', () => {
  it('normalises a users doc and drops uid-like display names', () => {
    expect(nameInfoFrom({ displayName: ' Sara ', username: '@sara' }, UID)).toEqual({ displayName: 'Sara', username: 'sara' });
    expect(nameInfoFrom({ displayName: UID }, UID)).toEqual({ displayName: null, username: null });
    expect(nameInfoFrom(undefined, UID)).toEqual({ displayName: null, username: null });
  });
  it('looksLikeUid', () => {
    expect(looksLikeUid('CjEJcD', UID)).toBe(true);
    expect(looksLikeUid('Sara', UID)).toBe(false);
  });
});
