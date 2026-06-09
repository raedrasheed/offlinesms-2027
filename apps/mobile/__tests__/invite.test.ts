import { describe, it, expect } from 'vitest';
import { inviteUrl, inviteDeepLink, parseInviteCode } from '../src/lib/invite';

describe('invite url helpers', () => {
  it('builds https + deep links', () => {
    expect(inviteUrl('ABCDEFGH')).toBe('https://offlinesms.com/join/ABCDEFGH');
    expect(inviteDeepLink('ABCDEFGH')).toBe('offlinesms://join/ABCDEFGH');
  });
  it('parses the code from either form', () => {
    expect(parseInviteCode('https://offlinesms.com/join/ABCDEFGH')).toBe('ABCDEFGH');
    expect(parseInviteCode('offlinesms://join/XYZ123')).toBe('XYZ123');
    expect(parseInviteCode('https://offlinesms.com/join/ABCDEFGH?ref=x')).toBe('ABCDEFGH');
  });
  it('returns null for non-invite urls', () => {
    expect(parseInviteCode('https://offlinesms.com/about')).toBeNull();
  });
});
