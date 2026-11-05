import { beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { type Firestore, type Transaction } from 'firebase-admin/firestore';
import {
  reconcileGroupMediaAccess, type ReconciliationResult,
} from '../../scripts/reconcileGroupMediaAccess';
import { db, resetEmulators } from './harness';

beforeEach(resetEmulators);

async function seedGroup(id = 'reconcile-group', fields: Record<string, unknown> = {}) {
  const ref = db().collection('conversations').doc(id);
  await ref.set({
    type: 'group', participantUids: ['owner', 'active', 'legacy', 'removed', 'missing', 'null-status'],
    memberIds: ['owner', 'active', 'legacy', 'removed', 'missing', 'null-status', 'stale'],
    memberCount: 99, name: 'Keep group details', ownerUid: 'owner', ...fields,
  });
  const batch = db().batch();
  for (const [uid, status] of [
    ['owner', 'active'], ['active', 'active'], ['legacy', undefined],
    ['removed', 'removed'], ['null-status', null], ['stale', 'active'],
  ] as const) {
    batch.set(ref.collection('members').doc(uid), {
      role: uid === 'owner' ? 'owner' : 'member', ...(status === undefined ? {} : { status }),
    });
  }
  batch.set(ref.collection('messages').doc('existing'), { type: 'image', text: 'Preserve message' });
  await batch.commit();
  return ref;
}

describe('transactional group media access reconciliation', () => {
  it('dry run reports removals without changing group, members or messages', async () => {
    const ref = await seedGroup();
    const before = (await ref.get()).data();
    const result = await reconcileGroupMediaAccess(db(), ref.id);
    expect(result).toEqual({
      groupId: ref.id, outcome: 'would-update', source: 'participantUids',
      beforeCount: 6, afterCount: 3, removedCount: 3,
    });
    expect((await ref.get()).data()).toEqual(before);
    expect((await ref.collection('members').doc('removed').get()).get('status')).toBe('removed');
    expect((await ref.collection('messages').doc('existing').get()).get('text')).toBe('Preserve message');
  });

  it('repairs stale arrays atomically, preserves unrelated data and is idempotent', async () => {
    const ref = await seedGroup();
    expect((await reconcileGroupMediaAccess(db(), ref.id, { apply: true })).outcome).toBe('applied');
    const after = (await ref.get()).data();
    expect(after).toEqual({
      type: 'group', participantUids: ['owner', 'active', 'legacy'],
      memberIds: ['owner', 'active', 'legacy'], memberCount: 3, mediaAclVersion: 2,
      name: 'Keep group details', ownerUid: 'owner',
    });
    expect((await ref.collection('members').get()).size).toBe(6);
    expect((await ref.collection('members').doc('stale').get()).get('status')).toBe('active');
    expect((await ref.collection('messages').doc('existing').get()).data())
      .toEqual({ type: 'image', text: 'Preserve message' });
    expect((await reconcileGroupMediaAccess(db(), ref.id, { apply: true })).outcome).toBe('unchanged');
    expect((await ref.get()).data()).toEqual(after);
  });

  it('revalidates previously marked groups instead of trusting mediaAclVersion', async () => {
    const ref = await seedGroup('previously-marked', { mediaAclVersion: 2 });
    await reconcileGroupMediaAccess(db(), ref.id, { apply: true });
    expect((await ref.get()).get('participantUids')).toEqual(['owner', 'active', 'legacy']);
  });

  it('falls back only for an absent canonical field; an empty canonical list stays empty', async () => {
    const legacy = db().doc('conversations/legacy-only');
    await legacy.set({ type: 'group', memberIds: ['owner', 'missing'] });
    await legacy.collection('members').doc('owner').set({});
    expect(await reconcileGroupMediaAccess(db(), legacy.id, { apply: true }))
      .toMatchObject({ source: 'memberIds', afterCount: 1, removedCount: 1 });
    expect((await legacy.get()).get('participantUids')).toEqual(['owner']);
    const empty = await seedGroup('empty-canonical', { participantUids: [] });
    await reconcileGroupMediaAccess(db(), empty.id, { apply: true });
    expect((await empty.get()).get('memberIds')).toEqual([]);
  });

  it('does not certify malformed groups, missing conversations or direct chats', async () => {
    for (const participantUids of [null, 'owner', ['owner', 'bad/path']]) {
      const ref = await seedGroup('malformed', { participantUids });
      const before = (await ref.get()).data();
      expect(await reconcileGroupMediaAccess(db(), ref.id, { apply: true }))
        .toMatchObject({ outcome: 'skipped', reason: 'invalid-canonical-membership' });
      expect((await ref.get()).data()).toEqual(before);
    }
    const direct = await seedGroup('direct-chat', { type: 'direct' });
    const before = (await direct.get()).data();
    expect(await reconcileGroupMediaAccess(db(), direct.id, { apply: true }))
      .toEqual({ groupId: direct.id, outcome: 'skipped', reason: 'not-group' });
    expect((await direct.get()).data()).toEqual(before);
    expect(await reconcileGroupMediaAccess(db(), 'does-not-exist', { apply: true }))
      .toEqual({ groupId: 'does-not-exist', outcome: 'skipped', reason: 'missing' });
  });


  it('revokes a forged marker on malformed groups without rewriting their membership', async () => {
    const ref = await seedGroup('malformed-marked', {
      participantUids: ['owner', 17], mediaAclVersion: 2,
    });
    const before = (await ref.get()).data()!;
    expect(await reconcileGroupMediaAccess(db(), ref.id))
      .toMatchObject({ outcome: 'skipped', reason: 'invalid-canonical-membership', markerAction: 'would-revoke' });
    expect((await ref.get()).data()).toEqual(before);
    expect(await reconcileGroupMediaAccess(db(), ref.id, { apply: true }))
      .toMatchObject({ outcome: 'skipped', reason: 'invalid-canonical-membership', markerAction: 'revoked' });
    const { mediaAclVersion: _marker, ...unmarked } = before;
    expect((await ref.get()).data()).toEqual(unmarked);
  });

  it('checks members beyond the first two read batches before stamping the group', async () => {
    const ref = db().doc('conversations/large-group');
    const uids = Array.from({ length: 205 }, (_, index) => 'member-' + index);
    const batch = db().batch();
    batch.set(ref, { type: 'group', participantUids: uids });
    for (const [index, uid] of uids.entries()) {
      // A missing and a removed member in the final batch must both be filtered.
      if (index === 203) continue;
      batch.set(ref.collection('members').doc(uid), { status: index === 204 ? 'removed' : 'active' });
    }
    await batch.commit();
    expect(await reconcileGroupMediaAccess(db(), ref.id, { apply: true }))
      .toMatchObject({ outcome: 'applied', beforeCount: 205, afterCount: 203, removedCount: 2 });
    const after = (await ref.get()).data()!;
    expect(after.participantUids).toEqual(uids.slice(0, 203));
    expect(after.memberIds).toEqual(after.participantUids);
    expect(after.mediaAclVersion).toBe(2);
  });

  it('rereads member state on transaction retry instead of committing an obsolete grant', async () => {
    const firestore = db();
    const ref = firestore.doc('conversations/retry-group');
    await ref.set({ type: 'group', participantUids: ['owner', 'peer'], memberIds: ['owner', 'peer'] });
    await ref.collection('members').doc('owner').set({ status: 'active' });
    const peer = ref.collection('members').doc('peer');
    await peer.set({ status: 'active' });
    let attempts = 0;
    let removal: Promise<unknown> | undefined;
    // Deterministically abort the first transaction after its reads. The queued
    // member update completes after rollback releases its lock. The real SDK
    // retries, so the production callback must reread and exclude this member.
    const retryingClient = {
      collection: firestore.collection.bind(firestore),
      runTransaction: (callback: (transaction: Transaction) => Promise<ReconciliationResult>) =>
        firestore.runTransaction(async transaction => {
          attempts++;
          if (removal) await removal;
          const result = await callback(transaction);
          if (attempts === 1) {
            removal = peer.update({ status: 'removed' });
            throw Object.assign(new Error('Induced retry after concurrent member change'), { code: 10 });
          }
          return result;
        }),
    } as unknown as Firestore;
    const result = await reconcileGroupMediaAccess(retryingClient, ref.id, { apply: true });
    expect(attempts).toBeGreaterThan(1);
    expect(result).toMatchObject({ outcome: 'applied', afterCount: 1, removedCount: 1 });
    expect((await ref.get()).get('participantUids')).toEqual(['owner']);
    expect((await ref.get()).get('memberIds')).toEqual(['owner']);
    expect((await peer.get()).get('status')).toBe('removed');
  });
});

describe('group media reconciliation CLI', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [
    '--import', 'tsx', 'scripts/reconcileGroupMediaAccess.ts', '--project=demo-offlinesms', ...args,
  ], {
    cwd: process.cwd().endsWith('functions') ? '..' : process.cwd(), encoding: 'utf8',
    env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: '' }, timeout: 30_000,
  });

  it('defaults to dry run; --apply certifies only the selected group', async () => {
    const ref = await seedGroup();
    const other = await seedGroup('other-group');
    const before = (await ref.get()).data();
    const dryRun = run('--group=' + ref.id);
    expect(dryRun.status, dryRun.stderr).toBe(0);
    expect(dryRun.stdout).toContain('"mode":"dry-run"');
    expect(dryRun.stdout).toContain('"outcome":"would-update"');
    expect((await ref.get()).data()).toEqual(before);
    const apply = run('--group=' + ref.id, '--apply');
    expect(apply.status, apply.stderr).toBe(0);
    expect(apply.stdout).toContain('"outcome":"applied"');
    expect((await ref.get()).get('mediaAclVersion')).toBe(2);
    expect((await other.get()).get('mediaAclVersion')).toBeUndefined();
  });

  it('returns a failing status for malformed canonical data without stamping it', async () => {
    const ref = await seedGroup('invalid-cli', { participantUids: null });
    const result = run('--group=' + ref.id, '--apply');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('"reason":"invalid-canonical-membership"');
    expect((await ref.get()).get('mediaAclVersion')).toBeUndefined();
  });
});
