import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { db, req, resetEmulators } from './harness';
import { queueClipAccountErasure, processClipAccountErasure, onClipUserDeleted, onClipAuthUserDeleted } from '../src/clips/accountCleanup';
import { deleteMyAccount } from '../src/auth/deleteAccount';
import { canViewClip, assertActiveClipUser } from '../src/clips/access';

beforeEach(async () => {
  await resetEmulators();
  for (const uid of ['owner', 'peer', 'follower']) await db().doc(`users/${uid}`).set({ status: 'active', displayName: uid });
});
afterEach(() => vi.restoreAllMocks());
async function drain(uid = 'owner') {
  for (let i = 0; i < 80; i++) {
    await processClipAccountErasure(db(), uid);
    if ((await db().doc(`clipAccountErasureJobs/${uid}`).get()).get('status') === 'done') return;
  }
  throw new Error('Erasure did not finish within bounded test pages');
}

describe('durable Clips account erasure', () => {
  it('rejects an auth-switched expected identity before queuing or deleting anything', async () => {
    await getAuth().createUser({ uid: 'owner' });
    await expect(deleteMyAccount.run(req('owner', { expectedUid: 'peer' }))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db().doc('users/owner').get()).exists).toBe(true);
    expect((await db().doc('users/peer').get()).exists).toBe(true);
    expect((await db().doc('clipAccountErasureJobs/owner').get()).exists).toBe(false);
    expect((await db().doc('clipProfiles/owner').get()).exists).toBe(false);
    expect((await getAuth().getUser('owner')).uid).toBe('owner');
  });

  it('leaves identity intact when the durable erasure fence cannot be persisted', async () => {
    await getAuth().createUser({ uid: 'owner' });
    vi.spyOn(db(), 'runTransaction').mockRejectedValueOnce(new Error('Transient database outage'));
    await expect(deleteMyAccount.run(req('owner', { expectedUid: 'owner' }))).rejects.toMatchObject({ code: 'unavailable' });
    expect((await db().doc('users/owner').get()).exists).toBe(true);
    expect((await getAuth().getUser('owner')).uid).toBe('owner');
    expect((await db().doc('clipAccountErasureJobs/owner').get()).exists).toBe(false);
  });

  it('does not block erasure for a legacy custom UID outside the public clip alphabet', async () => {
    await queueClipAccountErasure(db(), 'legacy:identity');
    await drain('legacy:identity');
    expect((await db().doc('clipProfiles/legacy:identity').get()).get('deleting')).toBe(true);
    expect((await db().doc('clipAccountErasureJobs/legacy:identity').get()).get('status')).toBe('done');
  });

  it('fences deletion before Auth removal, preserving a private tombstone and durable queue', async () => {
    await getAuth().createUser({ uid: 'owner' });
    await db().doc('clipProfiles/owner').set({ bio: 'Private bio', termsVersion: 'clips-v1', privateAccount: false });
    await db().doc('clips/owned').set({ ownerUid: 'owner', status: 'published', audience: 'public' });
    await deleteMyAccount.run(req('owner', {}));
    expect((await db().doc('users/owner').get()).exists).toBe(false);
    await expect(getAuth().getUser('owner')).rejects.toMatchObject({ code: 'auth/user-not-found' });
    const profile = await db().doc('clipProfiles/owner').get();
    expect(profile.data()).toMatchObject({ suspended: true, deleting: true, deletedAccount: true });
    expect(profile.get('bio')).toBeUndefined();
    expect((await db().doc('clipAccountErasureJobs/owner').get()).get('status')).toBe('pending');
    expect(await canViewClip(db(), { ownerUid: 'owner', status: 'published', audience: 'public' }, 'peer')).toBe(false);
    await expect(assertActiveClipUser(db(), 'owner')).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('pages through every owned clip and resumes after interruption without restoring erased content', async () => {
    const batch = db().batch();
    for (let i = 0; i < 61; i++) batch.set(db().doc(`clips/clip${String(i).padStart(3, '0')}`), {
      ownerUid: 'owner', status: 'published', audience: 'public', caption: 'Private caption', ownerName: 'Real name',
      edits: { overlayText: 'Private overlay' }, ownerPhotoURL: 'https://private.example/photo', groupId: 'group',
    });
    await batch.commit();
    await queueClipAccountErasure(db(), 'owner');
    await processClipAccountErasure(db(), 'owner');
    const partial = await db().collection('clips').where('status', '==', 'removed').get();
    expect(partial.size).toBe(25);
    const checkpoint = (await db().doc('clipAccountErasureJobs/owner').get()).get('cursor');
    expect(checkpoint).toBe('clips/clip024');
    // Repeated deletion events must preserve the checkpoint.
    await queueClipAccountErasure(db(), 'owner');
    expect((await db().doc('clipAccountErasureJobs/owner').get()).get('cursor')).toBe(checkpoint);
    await drain();
    const rows = await db().collection('clips').get();
    expect(rows.size).toBe(61);
    for (const row of rows.docs) {
      expect(row.data()).toMatchObject({ status: 'removed', ownerUid: 'owner', audience: 'private', caption: '', ownerName: null, ownerPhotoURL: null, groupId: null });
      expect(row.get('edits')).toBeUndefined();
    }
    await processClipAccountErasure(db(), 'owner');
    expect((await db().doc('clipAccountErasureJobs/owner').get()).get('status')).toBe('done');
  });

  it('removes private relations, interactions and comment identity with exactly-once live counters', async () => {
    const seed: Record<string, Record<string, unknown>> = {
      'clipProfiles/owner': { followingCount: 1, followerCount: 1, bio: 'Private' },
      'clipProfiles/peer': { followerCount: 5 }, 'clipProfiles/follower': { followingCount: 4 },
      'clipProfiles/owner/following/peer': { status: 'accepted' }, 'clipProfiles/peer/followers/owner': { status: 'accepted' },
      'clipProfiles/owner/followers/follower': { status: 'accepted' }, 'clipProfiles/follower/following/owner': { status: 'accepted' },
      'clips/peerclip': { ownerUid: 'peer', status: 'published', audience: 'public', likeCount: 3, commentCount: 2, viewCount: 8 },
      'clips/peerclip/likes/owner': { uid: 'owner' }, 'clips/peerclip/saves/owner': { uid: 'owner' },
      'clips/peerclip/views/owner': { uid: 'owner' }, 'clips/peerclip/shares/share': { senderUid: 'owner' },
      'clips/peerclip/comments/parent': { authorUid: 'peer', text: 'Parent', likeCount: 2, replyCount: 1 },
      'clips/peerclip/comments/parent/likes/owner': { uid: 'owner' },
      'clips/peerclip/comments/reply': { authorUid: 'owner', parentId: 'parent', text: 'Erase me', deleted: false, clientId: 'private-id' },
      'clipProfiles/owner/saved/peerclip': { createdAt: Timestamp.now() }, 'clipProfiles/owner/hidden/peerclip': { createdAt: Timestamp.now() },
      'clipProfiles/owner/rateLimits/like': { count: 1 }, 'clipProfiles/owner/uploadQuota/today': { count: 1 },
      'clipReports/report': { reporterUid: 'owner', details: 'Private report details', status: 'open' },
      // An unrelated product's collection group must not be modified.
      'other/product/likes/unrelated': { uid: 'owner' },
    };
    for (const [path, data] of Object.entries(seed)) await db().doc(path).set(data);
    await queueClipAccountErasure(db(), 'owner'); await drain(); await drain();
    expect((await db().doc('clipProfiles/peer').get()).get('followerCount')).toBe(4);
    expect((await db().doc('clipProfiles/follower').get()).get('followingCount')).toBe(3);
    expect((await db().doc('clips/peerclip').get()).data()).toMatchObject({ likeCount: 2, commentCount: 1, viewCount: 8 });
    expect((await db().doc('clips/peerclip/comments/parent').get()).data()).toMatchObject({ likeCount: 1, replyCount: 0 });
    const reply = await db().doc('clips/peerclip/comments/reply').get();
    expect(reply.data()).toMatchObject({ authorUid: null, text: '', deleted: true });
    expect(reply.get('clientId')).toBeUndefined();
    for (const path of ['clipProfiles/peer/followers/owner', 'clipProfiles/follower/following/owner',
      'clips/peerclip/likes/owner', 'clips/peerclip/saves/owner', 'clips/peerclip/views/owner',
      'clips/peerclip/comments/parent/likes/owner', 'clips/peerclip/shares/share', 'clipProfiles/owner/saved/peerclip',
      'clipProfiles/owner/hidden/peerclip', 'clipProfiles/owner/rateLimits/like', 'clipProfiles/owner/uploadQuota/today'])
      expect((await db().doc(path).get()).exists, path).toBe(false);
    expect((await db().doc('clipReports/report').get()).data()).toMatchObject({ reporterUid: null, details: '', status: 'open' });
    expect((await db().doc('other/product/likes/unrelated').get()).exists).toBe(true);
  });

  it('recovers an expired lease and external user deletion events idempotently', async () => {
    await onClipUserDeleted.run({ params: { uid: 'owner' } } as any);
    await db().doc('clipAccountErasureJobs/owner').update({ leaseToken: 'live-worker', leaseUntil: Timestamp.fromMillis(Date.now() + 60_000) });
    await processClipAccountErasure(db(), 'owner');
    expect((await db().doc('clipAccountErasureJobs/owner').get()).get('phase')).toBe('clips');
    await db().doc('clipAccountErasureJobs/owner').update({ leaseToken: 'dead-worker', leaseUntil: Timestamp.fromMillis(Date.now() - 1) });
    await processClipAccountErasure(db(), 'owner');
    expect((await db().doc('clipAccountErasureJobs/owner').get()).get('phase')).toBe('followers');
    await (onClipAuthUserDeleted as any).run({ uid: 'owner' }, {});
    expect((await db().doc('clipAccountErasureJobs/owner').get()).get('phase')).toBe('followers');
    await drain();
  });
});
