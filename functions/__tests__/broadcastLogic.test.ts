import { describe, it, expect } from 'vitest';
import {
  validateBroadcast, canTargetAudience, buildBroadcastContent,
  chunkTokens, maskFcmToken, TITLE_MAX, BODY_MAX, SEND_BATCH_SIZE,
} from '../src/notifications/broadcastLogic';

const base = {
  title: 'Service update',
  body:  'Scheduled maintenance tomorrow at 10pm.',
  actionType: 'open_app' as const,
  audience: { type: 'all_users' as const },
};

describe('validateBroadcast', () => {
  it('accepts a minimal valid broadcast', () => {
    expect(validateBroadcast(base)).toBeNull();
  });
  it('rejects empty title/body', () => {
    expect(validateBroadcast({ ...base, title: '   ' })).toBe('title-required');
    expect(validateBroadcast({ ...base, body: '' })).toBe('body-required');
  });
  it('enforces length caps', () => {
    expect(validateBroadcast({ ...base, title: 'x'.repeat(TITLE_MAX + 1) })).toBe('title-too-long');
    expect(validateBroadcast({ ...base, body:  'x'.repeat(BODY_MAX + 1) })).toBe('body-too-long');
  });
  it('rejects non-https image URLs', () => {
    expect(validateBroadcast({ ...base, imageUrl: 'http://example.com/x.png' })).toBe('image-not-https');
    expect(validateBroadcast({ ...base, imageUrl: 'https://example.com/x.png' })).toBeNull();
  });
  it('rejects unknown action types', () => {
    expect(validateBroadcast({ ...base, actionType: 'foo' as any })).toBe('action-invalid');
  });
  it('requires + https-checks an open_url target', () => {
    expect(validateBroadcast({ ...base, actionType: 'open_url' })).toBe('action-target-required');
    expect(validateBroadcast({ ...base, actionType: 'open_url', actionTarget: 'http://x.com' })).toBe('action-target-not-https');
    expect(validateBroadcast({ ...base, actionType: 'open_url', actionTarget: 'https://x.com' })).toBeNull();
  });
  it('requires a target for chat/group/campaign actions', () => {
    expect(validateBroadcast({ ...base, actionType: 'open_chat' })).toBe('action-target-required');
    expect(validateBroadcast({ ...base, actionType: 'open_group' })).toBe('action-target-required');
  });

  it('audience: organization needs organizationIds', () => {
    expect(validateBroadcast({ ...base, audience: { type: 'organization' } })).toBe('audience-missing-org');
    expect(validateBroadcast({ ...base, audience: { type: 'organization', organizationIds: ['o1'] } })).toBeNull();
  });
  it('audience: selected_users needs userIds[]', () => {
    expect(validateBroadcast({ ...base, audience: { type: 'selected_users', userIds: [] } })).toBe('audience-missing-users');
    expect(validateBroadcast({ ...base, audience: { type: 'selected_users', userIds: ['u1','u2'] } })).toBeNull();
  });
  it('audience: single_user needs exactly one id', () => {
    expect(validateBroadcast({ ...base, audience: { type: 'single_user', userIds: [] } })).toBe('audience-missing-user');
    expect(validateBroadcast({ ...base, audience: { type: 'single_user', userIds: ['u1','u2'] } })).toBe('audience-missing-user');
    expect(validateBroadcast({ ...base, audience: { type: 'single_user', userIds: ['u1'] } })).toBeNull();
  });
  it('audience: role must be a known role', () => {
    expect(validateBroadcast({ ...base, audience: { type: 'role' } })).toBe('audience-missing-role');
    expect(validateBroadcast({ ...base, audience: { type: 'role', role: 'unknown' } })).toBe('audience-role-invalid');
    expect(validateBroadcast({ ...base, audience: { type: 'role', role: 'support_agent' } })).toBeNull();
  });
});

describe('canTargetAudience (org-admin scope guard)', () => {
  it('super_admin (no orgId) can target anything', () => {
    expect(canTargetAudience(undefined, { type: 'all_users' })).toBeNull();
    expect(canTargetAudience(undefined, { type: 'role', role: 'support_agent' })).toBeNull();
    expect(canTargetAudience(undefined, { type: 'organization', organizationIds: ['o2'] })).toBeNull();
  });
  it('org_admin cannot target all_users or roles', () => {
    expect(canTargetAudience('o1', { type: 'all_users' })).toBe('org-admin-cannot-target-all');
    expect(canTargetAudience('o1', { type: 'role', role: 'support_agent' })).toBe('org-admin-cannot-target-role');
  });
  it('org_admin can only target their own org', () => {
    expect(canTargetAudience('o1', { type: 'organization', organizationIds: ['o1'] })).toBeNull();
    expect(canTargetAudience('o1', { type: 'organization', organizationIds: ['o2'] })).toBe('org-admin-org-mismatch');
    expect(canTargetAudience('o1', { type: 'organization', organizationIds: ['o1', 'o2'] })).toBe('org-admin-org-mismatch');
  });
  it('org_admin can target selected/single users (org membership verified server-side)', () => {
    expect(canTargetAudience('o1', { type: 'selected_users', userIds: ['u1','u2'] })).toBeNull();
    expect(canTargetAudience('o1', { type: 'single_user',    userIds: ['u1'] })).toBeNull();
  });
});

describe('buildBroadcastContent', () => {
  it('strips whitespace and tags admin_broadcast', () => {
    const { display, data } = buildBroadcastContent('b1', { ...base, title: '  Hi  ', body: '  ok  ' });
    expect(display).toEqual({ title: 'Hi', body: 'ok' });
    expect(data).toEqual({ type: 'admin_broadcast', broadcastId: 'b1', actionType: 'open_app' });
  });
  it('includes https image and actionTarget when present', () => {
    const { display, data } = buildBroadcastContent('b1', {
      ...base, imageUrl: 'https://cdn.x/p.png', actionType: 'open_url', actionTarget: 'https://x.com',
    });
    expect(display.imageUrl).toBe('https://cdn.x/p.png');
    expect(data.actionTarget).toBe('https://x.com');
  });
  it('drops non-https images defensively', () => {
    const { display } = buildBroadcastContent('b1', { ...base, imageUrl: 'http://nope' });
    expect(display.imageUrl).toBeUndefined();
  });
});

describe('chunkTokens', () => {
  it('splits to the configured size', () => {
    const tokens = Array.from({ length: 1234 }, (_, i) => `t${i}`);
    const chunks = chunkTokens(tokens, 500);
    expect(chunks.map(c => c.length)).toEqual([500, 500, 234]);
    expect(chunks[chunks.length - 1][233]).toBe('t1233');
  });
  it('returns empty list for no tokens', () => {
    expect(chunkTokens([], SEND_BATCH_SIZE)).toEqual([]);
  });
});

describe('maskFcmToken', () => {
  it('keeps only the last 6 chars', () => {
    expect(maskFcmToken('fgJFAt6rRmGEwSbS1rQfq2:APA91bAbCDef')).toBe('••• AbCDef');
    expect(maskFcmToken('')).toBe('');
    expect(maskFcmToken('abc')).toBe('••••');
  });
});
