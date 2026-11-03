import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { db, req, resetEmulators } from './harness';
import { addClipComment, listClipComments, reportClip, shareClip } from '../src/clips/core';
import { queueClipAccountErasure } from '../src/clips/accountCleanup';
import { getClipPlayback } from '../src/clips/media';

beforeEach(async () => {
  await resetEmulators();
  await db().doc('systemSettings/clips').set({ enabled: true, moderationRequired: true, termsVersion: 'clips-v1' });
  for (const uid of ['owner', 'viewer', 'peer']) {
    await db().doc(`users/${uid}`).set({ status: 'active', displayName: uid });
    await db().doc(`clipProfiles/${uid}`).set({ termsVersion: 'clips-v1' });
  }
  await db().doc('clips/video').set({ ownerUid: 'owner', status: 'published', audience: 'public',
    caption: 'Private caption', createdAt: Timestamp.now(), allowComments: true, commentCount: 0, shareCount: 0,
    standardPath: 'clipMedia/owner/video/standard.mp4', dataSaverPath: 'clipMedia/owner/video/dataSaver.mp4', coverPath: 'clipMedia/owner/video/cover.jpg' });
  await db().doc('conversations/direct').set({ type: 'direct', participantUids: ['viewer', 'peer'] });
});
afterEach(() => vi.restoreAllMocks());

describe('independent Clips access and erasure regression checks', () => {
  it.each(['comment', 'share', 'report'])('rejects a late %s commit after the account erasure fence', async action => {
    const store = db(), realTransaction = store.runTransaction.bind(store); let transactions = 0;
    const hook = vi.spyOn(store, 'runTransaction').mockImplementation(async (callback: any, options: any) => {
      transactions++;
      // The first transaction is the per-action rate bucket. Erase immediately
      // before the actual mutation transaction, after every preflight completed.
      if (transactions === 2) await queueClipAccountErasure(store, 'viewer');
      return realTransaction(callback, options);
    });
    const work = action === 'comment' ? addClipComment.run(req('viewer', { clipId: 'video', text: 'Late private content', clientId: 'late-comment' }))
      : action === 'share' ? shareClip.run(req('viewer', { clipId: 'video', conversationId: 'direct', clientId: 'late-share' }))
      : reportClip.run(req('viewer', { clipId: 'video', reason: 'abuse', details: 'Late private report' }));
    await expect(work).rejects.toMatchObject({ code: 'permission-denied' }); hook.mockRestore();
    expect((await store.doc('clips/video').get()).data()).toMatchObject({ commentCount: 0, shareCount: 0 });
    expect((await store.collection('clips/video/comments').get()).empty).toBe(true);
    expect((await store.collection('conversations/direct/messages').get()).empty).toBe(true);
    expect((await store.collection('clipReports').get()).empty).toBe(true);
    expect((await store.doc('clipProfiles/viewer').get()).get('deleting')).toBe(true);
  });

  it('reporting never grants access to private, pending, blocked or revoked-group content', async () => {
    const report = () => reportClip.run(req('viewer', { clipId: 'video', reason: 'spam' }));
    await db().doc('clips/video').update({ audience: 'private' });
    await expect(report()).rejects.toMatchObject({ code: 'not-found' });
    await db().doc('clips/video').update({ audience: 'public', status: 'pending_review' });
    await expect(report()).rejects.toMatchObject({ code: 'not-found' });
    await db().doc('clips/video').update({ status: 'published' });
    await db().doc('users/owner/blockedUsers/viewer').set({});
    await expect(report()).rejects.toMatchObject({ code: 'not-found' });
    await db().doc('users/owner/blockedUsers/viewer').delete();
    await db().doc('clips/video').update({ audience: 'group', groupId: 'group' });
    await db().doc('conversations/group').set({ type: 'group', participantUids: ['owner', 'viewer'] });
    await db().doc('conversations/group/members/viewer').set({ status: 'removed' });
    await expect(report()).rejects.toMatchObject({ code: 'not-found' });
    expect((await db().collection('clipReports').get()).empty).toBe(true);
  });

  it('blocks stale deleted and disabled administrator identities before signing media', async () => {
    const input = req('viewer', { clipId: 'video' }, { claims: { role: 'super_admin', admin: true } });
    await db().doc('users/viewer').delete();
    await expect(getClipPlayback.run(input)).rejects.toMatchObject({ code: 'permission-denied' });
    await db().doc('users/viewer').set({ status: 'active', disabled: true });
    await expect(getClipPlayback.run(input)).rejects.toMatchObject({ code: 'permission-denied' });
    await db().doc('users/viewer').update({ disabled: false });
    await db().doc('clipProfiles/viewer').update({ deleting: true });
    await expect(getClipPlayback.run(input)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('keeps other people’s replies accessible after an erased parent becomes anonymous', async () => {
    await db().doc('clips/video/comments/parent').set({ authorUid: null, text: '', deleted: true,
      parentId: null, createdAt: Timestamp.now(), replyCount: 1 });
    await db().doc('clips/video/comments/reply').set({ authorUid: 'peer', text: 'My retained reply', deleted: false,
      parentId: 'parent', createdAt: Timestamp.now(), replyCount: 0 });
    const roots = await listClipComments.run(req('viewer', { clipId: 'video' }));
    expect(roots.items[0]).toMatchObject({ id: 'parent', authorUid: '', deleted: true, text: '', replyCount: 1 });
    const replies = await listClipComments.run(req('viewer', { clipId: 'video', parentId: 'parent' }));
    expect(replies.items[0]).toMatchObject({ authorUid: 'peer', text: 'My retained reply' });
  });
});
