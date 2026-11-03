import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ records: new Map<string, any>(), writes: [] as { path: string; data: any }[] }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: unknown) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string, public details?: unknown) { super(message); } },
}));
vi.mock('../src/lib/auditLog', () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('firebase-admin/firestore', () => {
  const snapshot = (path: string) => ({ exists: state.records.has(path), data: () => state.records.get(path), get: (key: string) => state.records.get(path)?.[key] });
  const document = (path: string): any => ({ path, id: path.split('/').at(-1), get: async () => snapshot(path), collection: (name: string) => collection(`${path}/${name}`) });
  const collection = (path: string): any => ({ doc: (id: string) => document(`${path}/${id}`) });
  return { FieldValue: { serverTimestamp: () => 'NOW' }, getFirestore: () => ({ collection,
    runTransaction: (callback: any) => callback({ get: async (ref: any) => snapshot(ref.path),
      set: (ref: any, data: any) => state.writes.push({ path: ref.path, data }),
      update: (ref: any, data: any) => state.writes.push({ path: ref.path, data }),
    }),
  }) };
});
import { joinGroupByInviteLink } from '../src/chats/groupInvites';
const call = () => (joinGroupByInviteLink as any)({ auth: { uid: 'me' }, data: { inviteCode: 'ABCDEFGH12345678' } });
beforeEach(() => { state.records.clear(); state.writes = [];
  state.records.set('inviteCodes/ABCDEFGH12345678', { conversationId: 'group-a', enabled: true, joinMode: 'open' });
  state.records.set('conversations/group-a', { type: 'group', participantUids: ['owner'], memberCount: 1 });
  state.records.set('users/me', { displayName: 'Member' });
});
describe('invite join profile requirement', () => {
  it('returns an actionable username reason and creates no membership for an incomplete account', async () => {
    await expect(call()).rejects.toMatchObject({ code: 'failed-precondition', message: 'username-required', details: { reason: 'username-required' } });
    expect(state.writes.filter(write => !write.path.startsWith('rateLimits/'))).toEqual([]);
  });
  it('joins after the username has been saved', async () => {
    state.records.set('users/me', { displayName: 'Member', username: 'member' });
    await expect(call()).resolves.toEqual({ status: 'joined', conversationId: 'group-a' });
    expect(state.writes.find(write => write.path === 'conversations/group-a/members/me')?.data).toMatchObject({ uid: 'me', status: 'active' });
  });
  it('preserves access for an existing member with an old profile', async () => {
    state.records.set('conversations/group-a/members/me', { uid: 'me', status: 'active' });
    await expect(call()).resolves.toEqual({ status: 'already_member', conversationId: 'group-a' });
    expect(state.writes.filter(write => !write.path.startsWith('rateLimits/'))).toEqual([]);
  });
  it('requires a username before creating an approval request', async () => {
    state.records.get('inviteCodes/ABCDEFGH12345678').joinMode = 'approval_required';
    await expect(call()).rejects.toMatchObject({ message: 'username-required' });
    expect(state.writes.some(write => write.path.includes('/joinRequests/'))).toBe(false);
  });
  it('preserves a pending request without duplicate writes or a new username gate', async () => {
    state.records.get('inviteCodes/ABCDEFGH12345678').joinMode = 'approval_required';
    state.records.set('conversations/group-a/joinRequests/me', { status: 'pending' });
    await expect(call()).resolves.toEqual({ status: 'pending', conversationId: 'group-a' });
    expect(state.writes.filter(write => !write.path.startsWith('rateLimits/'))).toEqual([]);
  });
  it('rejects a revoked invite even after profile completion', async () => {
    state.records.set('users/me', { username: 'member' }); state.records.get('inviteCodes/ABCDEFGH12345678').revokedAt = 1;
    await expect(call()).rejects.toMatchObject({ message: 'invite-disabled' });
    expect(state.writes.some(write => write.path.includes('/members/'))).toBe(false);
  });
});
