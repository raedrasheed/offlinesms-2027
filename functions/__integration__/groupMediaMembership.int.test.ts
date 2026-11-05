import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, req, resetEmulators, Timestamp, FieldValue } from './harness';
import { createGroup } from '../src/chats/createGroup';
import { respondToGroupInvitation } from '../src/chats/memberInvitations';
import { removeMember } from '../src/chats/removeMember';
import { leaveGroup } from '../src/chats/leaveGroup';

beforeEach(async () => {
  await resetEmulators();
  for (const uid of ['owner', 'alice', 'bob', 'carol']) {
    await db().doc(`users/${uid}`).set({ displayName: uid, username: uid, status: 'active' });
  }
});
afterEach(() => vi.restoreAllMocks());

async function create(memberUids = ['alice', 'bob']) {
  return (await createGroup.run(req('owner', { name: 'Media ACL', memberUids }))).conversationId;
}
async function joinedGroup(memberUids = ['alice', 'bob']) {
  const cid = await create(memberUids);
  for (const uid of memberUids) {
    await respondToGroupInvitation.run(req(uid, { conversationId: cid, accept: true }));
  }
  return cid;
}
const group = (cid: string) => db().doc(`conversations/${cid}`);
const member = (cid: string, uid: string) => group(cid).collection('members').doc(uid);
const remove = (cid: string, uid: string, actor = 'owner') =>
  removeMember.run(req(actor, { conversationId: cid, memberUid: uid }));
const leave = (cid: string, uid: string) =>
  leaveGroup.run(req(uid, { conversationId: cid }));

// Start both real emulator transactions together. A handler that regresses to
// an unprotected read + batch is detected even if that run happens to serialize.
async function concurrently(operations: Array<() => Promise<unknown>>) {
  const original = db().runTransaction.bind(db());
  let entered = 0, completed = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const transaction = vi.spyOn(db(), 'runTransaction').mockImplementation(async (fn: any, options?: any) => {
    entered++;
    if (entered + completed >= operations.length) release();
    await ready;
    return original(fn, options);
  });
  try {
    await Promise.all(operations.map(async operation => {
      try { return await operation(); }
      finally {
        completed++;
        if (entered + completed >= operations.length) release();
      }
    }));
    expect(transaction).toHaveBeenCalledTimes(operations.length);
  } finally {
    transaction.mockRestore();
  }
}

async function expectRoster(cid: string, uids: string[]) {
  const data = (await group(cid).get()).data()!;
  expect(data.participantUids.slice().sort()).toEqual(uids.slice().sort());
  expect(data.memberIds.slice().sort()).toEqual(uids.slice().sort());
  expect(data.memberCount).toBe(uids.length);
}

describe('transactional group media membership', () => {
  it('marks only the owner roster at creation and keeps pending invitees outside the ACL', async () => {
    const cid = await create();
    expect((await group(cid).get()).get('mediaAclVersion')).toBe(2);
    await expectRoster(cid, ['owner']);
    expect((await member(cid, 'alice').get()).exists).toBe(false);
    expect((await member(cid, 'owner').get()).data()).toMatchObject({ role: 'owner', status: 'active' });
    await respondToGroupInvitation.run(req('alice', { conversationId: cid, accept: true }));
    await expectRoster(cid, ['owner', 'alice']);
    expect((await group(cid).get()).get('mediaAclVersion')).toBe(2);
  });

  it('concurrent removals never restore either departed UID', async () => {
    const cid = await joinedGroup();
    await concurrently([() => remove(cid, 'alice'), () => remove(cid, 'bob')]);
    await expectRoster(cid, ['owner']);
    for (const uid of ['alice', 'bob']) {
      expect((await member(cid, uid).get()).data()).toMatchObject({ status: 'removed', role: 'member' });
    }
    expect((await group(cid).get()).get('mediaAclVersion')).toBe(2);
  });

  it('a leave racing with a removal cannot restore an inactive member', async () => {
    const cid = await joinedGroup();
    await concurrently([() => leave(cid, 'alice'), () => remove(cid, 'bob')]);
    await expectRoster(cid, ['owner']);
    expect((await member(cid, 'alice').get()).get('status')).toBe('left');
    expect((await member(cid, 'bob').get()).get('status')).toBe('removed');
  });

  it('concurrent owner and successor departures transfer ownership to a remaining active member', async () => {
    const cid = await joinedGroup();
    await member(cid, 'alice').update({ role: 'admin', joinedAt: Timestamp.fromMillis(20) });
    await member(cid, 'bob').update({ joinedAt: Timestamp.fromMillis(10) });
    await concurrently([() => leave(cid, 'owner'), () => leave(cid, 'alice')]);
    await expectRoster(cid, ['bob']);
    expect((await group(cid).get()).get('ownerUid')).toBe('bob');
    expect((await member(cid, 'bob').get()).data()).toMatchObject({ role: 'owner', status: 'active' });
    for (const uid of ['owner', 'alice']) {
      expect((await member(cid, uid).get()).data()).toMatchObject({ role: 'member', status: 'left' });
    }
  });

  it('prefers an active admin for ownership and excludes stale members outside the roster', async () => {
    const cid = await joinedGroup();
    await member(cid, 'alice').update({ role: 'admin', joinedAt: Timestamp.fromMillis(20) });
    await member(cid, 'bob').update({ joinedAt: Timestamp.fromMillis(10) });
    await member(cid, 'carol').set({ role: 'admin', status: 'active', joinedAt: Timestamp.fromMillis(1) });
    expect(await leave(cid, 'owner')).toMatchObject({ ownershipTransferredTo: 'alice' });
    await expectRoster(cid, ['alice', 'bob']);
    expect((await group(cid).get()).get('ownerUid')).toBe('alice');
  });

  it('disables a group when its last member leaves', async () => {
    const cid = await create([]);
    expect(await leave(cid, 'owner')).toEqual({ ok: true });
    await expectRoster(cid, []);
    expect((await group(cid).get()).get('status')).toBe('disabled');
    expect((await member(cid, 'owner').get()).get('status')).toBe('left');
  });

  it('preserves role restrictions and rejects an inactive caller with a stale privileged role', async () => {
    const cid = await joinedGroup();
    await expect(remove(cid, 'bob', 'alice')).rejects.toMatchObject({ code: 'permission-denied', message: 'admins-only' });
    await expect(remove(cid, 'owner')).rejects.toMatchObject({ code: 'invalid-argument', message: 'use-leave-group' });
    await member(cid, 'alice').update({ role: 'admin' });
    await expect(remove(cid, 'owner', 'alice')).rejects.toMatchObject({ code: 'permission-denied', message: 'cannot-remove-owner' });
    await member(cid, 'alice').update({ status: 'left' });
    await expect(remove(cid, 'bob', 'alice')).rejects.toMatchObject({ code: 'permission-denied', message: 'admins-only' });
    await expect(leave(cid, 'alice')).rejects.toMatchObject({ code: 'failed-precondition', message: 'not-a-member' });
    await expectRoster(cid, ['owner', 'alice', 'bob']);
  });

  it('does not certify unreconciled legacy groups during individual membership changes', async () => {
    const cid = await joinedGroup();
    await group(cid).update({ mediaAclVersion: FieldValue.delete() });
    await remove(cid, 'alice');
    await leave(cid, 'bob');
    expect((await group(cid).get()).get('mediaAclVersion')).toBeUndefined();
    await expectRoster(cid, ['owner']);
  });
});
