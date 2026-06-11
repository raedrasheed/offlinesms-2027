import { describe, it, expect } from 'vitest';
import {
  generateInviteCode, isValidInviteCode, joinDecision, inviteUsable,
  buildInvitePreview, inviteUrl,
} from '../src/chats/inviteLogic';

describe('generateInviteCode', () => {
  it('produces a 16-char code from the allowed alphabet', () => {
    const c = generateInviteCode();
    expect(c).toHaveLength(16);
    expect(isValidInviteCode(c)).toBe(true);
  });
  it('is effectively unique across many draws', () => {
    const set = new Set(Array.from({ length: 500 }, () => generateInviteCode()));
    expect(set.size).toBe(500);
  });
  it('excludes ambiguous characters (I, L, O, U)', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateInviteCode()).not.toMatch(/[ILOU]/);
    }
  });
});

describe('isValidInviteCode', () => {
  it('accepts well-formed codes, rejects junk', () => {
    expect(isValidInviteCode('ABCDEFGH')).toBe(true);
    expect(isValidInviteCode('abc')).toBe(false);       // too short + lowercase
    expect(isValidInviteCode('CODE-WITH-DASH')).toBe(false);
    expect(isValidInviteCode(123 as unknown)).toBe(false);
  });
});

describe('joinDecision', () => {
  it('already member short-circuits regardless of mode', () => {
    expect(joinDecision('open', true, false)).toBe('already_member');
    expect(joinDecision('approval_required', true, true)).toBe('already_member');
  });
  it('open mode joins immediately', () => {
    expect(joinDecision('open', false, false)).toBe('join_open');
  });
  it('approval mode creates a request, or returns the pending one', () => {
    expect(joinDecision('approval_required', false, false)).toBe('create_request');
    expect(joinDecision('approval_required', false, true)).toBe('request_pending');
  });
});

describe('inviteUsable', () => {
  it('requires enabled and not revoked', () => {
    expect(inviteUsable({ enabled: true })).toBe(true);
    expect(inviteUsable({ enabled: false })).toBe(false);
    expect(inviteUsable({ enabled: true, revokedAt: 123 })).toBe(false);
    expect(inviteUsable(null)).toBe(false);
  });
});

describe('buildInvitePreview (privacy-safe)', () => {
  const base = {
    conversationId: 'g1', groupName: 'Family', groupPhotoURL: null,
    memberCount: 5, joinMode: 'open' as const,
  };
  it('exposes only safe fields', () => {
    const p = buildInvitePreview({ ...base, usable: true, isMember: false, hasPendingRequest: false });
    expect(Object.keys(p).sort()).toEqual(
      ['conversationId', 'groupName', 'groupPhotoURL', 'hasPendingRequest', 'isMember', 'joinMode', 'memberCount', 'status'].sort(),
    );
    expect(p.status).toBe('can_join');
  });
  it('reports member / pending / disabled status', () => {
    expect(buildInvitePreview({ ...base, usable: true, isMember: true, hasPendingRequest: false }).status).toBe('already_member');
    expect(buildInvitePreview({ ...base, joinMode: 'approval_required', usable: true, isMember: false, hasPendingRequest: true }).status).toBe('request_pending');
    expect(buildInvitePreview({ ...base, usable: false, isMember: false, hasPendingRequest: false }).status).toBe('disabled');
  });
  it('defaults a blank group name', () => {
    expect(buildInvitePreview({ ...base, groupName: '   ', usable: true, isMember: false, hasPendingRequest: false }).groupName).toBe('Group');
  });
});

describe('inviteUrl', () => {
  it('builds the public link', () => {
    expect(inviteUrl('ABCDEFGH')).toBe('https://links.offlinesms.com/join/ABCDEFGH');
  });
});
