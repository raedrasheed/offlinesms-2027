import { describe, it, expect } from 'vitest';
import { shouldPromoteToMember, phoneChanged } from '../src/contacts/linkPhoneContacts';

describe('shouldPromoteToMember (no duplicate members on link)', () => {
  it('promotes a user who is not yet a participant', () => {
    expect(shouldPromoteToMember(['a', 'b'], 'c')).toBe(true);
  });
  it('does NOT promote a user who is already a participant', () => {
    expect(shouldPromoteToMember(['a', 'b', 'c'], 'c')).toBe(false);
  });
  it('handles missing participant array', () => {
    expect(shouldPromoteToMember(undefined, 'c')).toBe(true);
  });
});

describe('phoneChanged', () => {
  it('true when a number is first set', () => {
    expect(phoneChanged(null, '+972591234567')).toBe(true);
    expect(phoneChanged(undefined, '+972591234567')).toBe(true);
  });
  it('true when the number changes', () => {
    expect(phoneChanged('+972590000000', '+972591234567')).toBe(true);
  });
  it('false when unchanged', () => {
    expect(phoneChanged('+972591234567', '+972591234567')).toBe(false);
  });
  it('false when cleared / absent', () => {
    expect(phoneChanged('+972591234567', null)).toBe(false);
    expect(phoneChanged(null, null)).toBe(false);
  });
});
