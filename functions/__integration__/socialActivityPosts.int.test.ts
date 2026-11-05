// Archive behavior coverage only; production policy is tested in postsDisabled.int.test.ts.
vi.mock('../src/social/postsFeature', () => ({ POSTS_ENABLED: true, assertPostsEnabled: () => {} }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, req, resetEmulators, Timestamp, expectHttps } from './harness';
import { setClipInteraction, addClipComment, followClipCreator, respondClipFollowRequest } from '../src/clips/core';
import { listSocialActivity, markSocialActivityRead } from '../src/social/activity';
import { createPost, getPost, listPosts, setPostLike, addPostComment, listPostComments, deletePostComment, deletePost, reportPost } from '../src/social/posts';
import { processClipAccountErasure, queueClipAccountErasure } from '../src/clips/accountCleanup';

async function seed(uid: string) {
  await db().doc(`users/${uid}`).set({ displayName: uid, username: uid, status: 'active' });
  await db().doc(`clipProfiles/${uid}`).set({ termsVersion: 'clips-v1' });
}
beforeEach(async () => {
  await resetEmulators();
  await db().doc('systemSettings/clips').set({ enabled: true, moderationRequired: false, termsVersion: 'clips-v1' });
  await Promise.all(['alice', 'bob', 'carol'].map(seed));
  await db().doc('clips/video').set({ ownerUid: 'alice', status: 'published', audience: 'public', allowComments: true, likeCount: 0, commentCount: 0 });
});

describe('Private social activity', () => {
  it('writes one like event, suppresses self activity, marks only the authenticated inbox and removes an unlike', async () => {
    await setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: true }));
    await setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: true }));
    await setClipInteraction.run(req('alice', { clipId: 'video', type: 'like', active: true }));
    const page = await listSocialActivity.run(req('alice', {}));
    expect(page.items).toHaveLength(1); expect(page.items[0]).toMatchObject({ kind: 'like', unread: true, actor: { uid: 'bob' }, clipId: 'video' });
    await markSocialActivityRead.run(req('carol', { ids: [page.items[0].id] }));
    expect((await listSocialActivity.run(req('alice', {}))).items[0].unread).toBe(true);
    await markSocialActivityRead.run(req('alice', { ids: [page.items[0].id] }));
    expect((await listSocialActivity.run(req('alice', {}))).items[0].unread).toBe(false);
    await setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: false }));
    expect((await listSocialActivity.run(req('alice', {}))).items).toEqual([]);
  });
  it('hides old comment activity after a block, actor deletion or target removal', async () => {
    await addClipComment.run(req('bob', { clipId: 'video', clientId: 'comment1', text: 'hello' }));
    expect((await listSocialActivity.run(req('alice', {}))).items).toHaveLength(1);
    await db().doc('users/bob/blockedUsers/alice').set({});
    expect((await listSocialActivity.run(req('alice', {}))).items).toEqual([]);
    await db().doc('users/bob/blockedUsers/alice').delete();
    await db().doc('users/bob').delete();
    expect((await listSocialActivity.run(req('alice', {}))).items).toEqual([]);
    await seed('bob'); await db().doc('clips/video').update({ status: 'removed' });
    expect((await listSocialActivity.run(req('alice', {}))).items).toEqual([]);
  });
  it('notifies a private follow request and acceptance without duplicates', async () => {
    await db().doc('clipProfiles/alice').update({ privateAccount: true });
    await followClipCreator.run(req('bob', { uid: 'alice', following: true }));
    expect((await listSocialActivity.run(req('alice', {}))).items[0]).toMatchObject({ kind: 'follow', followStatus: 'pending' });
    await respondClipFollowRequest.run(req('alice', { uid: 'bob', accept: true }));
    expect((await listSocialActivity.run(req('bob', {}))).items[0]).toMatchObject({ kind: 'followAccepted', actor: { uid: 'alice' } });
    await followClipCreator.run(req('bob', { uid: 'alice', following: false }));
    expect((await listSocialActivity.run(req('alice', {}))).items).toEqual([]);
    expect((await listSocialActivity.run(req('bob', {}))).items).toEqual([]);
  });
  it('filters an expired story or removed mention at read time', async () => {
    await db().doc('statuses/story').set({ authorId: 'bob', audienceType: 'all_contacts', expiresAt: Timestamp.fromMillis(Date.now() + 60_000), mentions: [{ uid: 'alice' }] });
    await db().doc('clipProfiles/alice/activity/mention').set({ kind: 'statusMention', actorUid: 'bob', statusId: 'story', createdAt: Timestamp.now(), readAt: null });
    expect((await listSocialActivity.run(req('alice', {}))).items).toHaveLength(1);
    await db().doc('statuses/story').update({ mentions: [] });
    expect((await listSocialActivity.run(req('alice', {}))).items).toEqual([]);
    await db().doc('statuses/story').update({ mentions: [{ uid: 'alice' }], expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    expect((await listSocialActivity.run(req('alice', {}))).items).toEqual([]);
  });
  it('keeps stories available when clips are disabled and rejects deleted or disabled inbox accounts', async () => {
    await setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: true }));
    await db().doc('statuses/story').set({ authorId: 'bob', audienceType: 'all_contacts', expiresAt: Timestamp.fromMillis(Date.now() + 60_000), mentions: [{ uid: 'alice' }] });
    await db().doc('clipProfiles/alice/activity/mention').set({ kind: 'statusMention', actorUid: 'bob', statusId: 'story', createdAt: Timestamp.now(), readAt: null });
    await db().doc('systemSettings/clips').update({ enabled: false });
    expect((await listSocialActivity.run(req('alice', {}))).items.map(x => x.kind)).toEqual(['statusMention']);
    for (const status of ['disabled', 'deleted', 'suspended']) {
      await db().doc('users/alice').update({ status });
      await expectHttps(listSocialActivity.run(req('alice', {})), 'permission-denied');
      await expectHttps(markSocialActivityRead.run(req('alice', { ids: ['mention'] })), 'permission-denied');
    }
    await db().doc('users/alice').update({ status: 'active', deletedAccount: true });
    await expectHttps(listSocialActivity.run(req('alice', {})), 'permission-denied');
  });
});

describe('Text and image post access, moderation and interactions', () => {
  it('creates idempotently, obeys moderation and does not expose pending or private posts to others', async () => {
    await db().doc('systemSettings/clips').update({ moderationRequired: true });
    const first = await createPost.run(req('alice', { clientId: 'one', body: 'hello', audience: 'public' }));
    expect(first.post.status).toBe('pending_review');
    expect((await createPost.run(req('alice', { clientId: 'one', body: 'hello', audience: 'public' }))).post.id).toBe(first.post.id);
    expect((await listPosts.run(req('alice', { mode: 'mine' }))).items).toHaveLength(1);
    expect((await listPosts.run(req('bob', {}))).items).toEqual([]);
    await expectHttps(getPost.run(req('bob', { postId: first.post.id })), 'not-found');
    await db().doc(`posts/${first.post.id}`).update({ status: 'published', audience: 'private' });
    await expectHttps(getPost.run(req('bob', { postId: first.post.id })), 'not-found');
    await expectHttps(createPost.run(req('alice', { clientId: 'empty', body: '', audience: 'public' })), 'invalid-argument', 'post-empty');
  });
  it('enforces private account, accepted followers, both block directions and removed content', async () => {
    const { post } = await createPost.run(req('alice', { clientId: 'privateAccount', body: 'a post', audience: 'public' }));
    await db().doc('clipProfiles/alice').update({ privateAccount: true });
    await expectHttps(getPost.run(req('bob', { postId: post.id })), 'not-found');
    await followClipCreator.run(req('bob', { uid: 'alice', following: true }));
    await respondClipFollowRequest.run(req('alice', { uid: 'bob', accept: true }));
    expect((await getPost.run(req('bob', { postId: post.id }))).post.body).toBe('a post');
    await db().doc('users/bob/blockedUsers/alice').set({});
    await expectHttps(setPostLike.run(req('bob', { postId: post.id, active: true })), 'not-found');
    await db().doc('users/bob/blockedUsers/alice').delete();
    await deletePost.run(req('alice', { postId: post.id }));
    await expectHttps(getPost.run(req('alice', { postId: post.id })), 'not-found');
    expect((await listPosts.run(req('alice', { mode: 'mine' }))).items).toEqual([]);
  });
  it('uses current moderation and feature policy at the final publication transaction', async () => {
    const firestore = db(), original = firestore.runTransaction.bind(firestore); let calls = 0;
    const spy = vi.spyOn(firestore, 'runTransaction').mockImplementation(async (...args: Parameters<typeof original>) => {
      if (++calls === 2) await firestore.doc('systemSettings/clips').update({ moderationRequired: true });
      return original(...args);
    });
    try {
      expect((await createPost.run(req('alice', { clientId: 'changed-moderation', body: 'hello', audience: 'public' }))).post.status).toBe('pending_review');
    } finally { spy.mockRestore(); }
    calls = 0;
    const disabled = vi.spyOn(firestore, 'runTransaction').mockImplementation(async (...args: Parameters<typeof original>) => {
      if (++calls === 2) await firestore.doc('systemSettings/clips').update({ enabled: false });
      return original(...args);
    });
    try { await expectHttps(createPost.run(req('alice', { clientId: 'changed-master', body: 'hello', audience: 'public' })), 'failed-precondition', 'clips-disabled'); }
    finally { disabled.mockRestore(); }
    expect((await firestore.collection('posts').get()).size).toBe(1);
  });
  it('rejects posting by non-active accounts and hides posts by a tombstoned owner', async () => {
    const { post } = await createPost.run(req('alice', { clientId: 'active-owner', body: 'hello', audience: 'public' }));
    await db().doc('users/alice').update({ status: 'deleted' });
    await expectHttps(getPost.run(req('bob', { postId: post.id })), 'not-found');
    await expectHttps(createPost.run(req('alice', { clientId: 'deleted-owner', body: 'hello', audience: 'public' })), 'permission-denied');
    await db().doc('users/alice').update({ status: 'active' });
    await db().doc('clipProfiles/alice').update({ deletedAccount: true });
    await expectHttps(getPost.run(req('bob', { postId: post.id })), 'not-found');
  });
  it('likes and comments exactly once, records private activity, validates deletion rights and reports', async () => {
    const { post } = await createPost.run(req('alice', { clientId: 'social', body: 'hello', audience: 'public' }));
    expect(await setPostLike.run(req('bob', { postId: post.id, active: true }))).toEqual({ likeCount: 1 });
    expect(await setPostLike.run(req('bob', { postId: post.id, active: true }))).toEqual({ likeCount: 1 });
    const comment = await addPostComment.run(req('bob', { postId: post.id, clientId: 'same', text: 'comment' }));
    await addPostComment.run(req('bob', { postId: post.id, clientId: 'same', text: 'comment' }));
    expect((await getPost.run(req('alice', { postId: post.id }))).post.commentCount).toBe(1);
    expect((await listPostComments.run(req('carol', { postId: post.id }))).items[0].canDelete).toBe(false);
    await expectHttps(deletePostComment.run(req('carol', { postId: post.id, commentId: comment.commentId })), 'permission-denied');
    expect((await listSocialActivity.run(req('alice', {}))).items.map(x => x.kind).sort()).toEqual(['postComment', 'postLike']);
    await deletePostComment.run(req('alice', { postId: post.id, commentId: comment.commentId }));
    expect((await listPostComments.run(req('bob', { postId: post.id }))).items).toEqual([]);
    expect((await getPost.run(req('alice', { postId: post.id }))).post.commentCount).toBe(0);
    await reportPost.run(req('bob', { postId: post.id, reason: 'spam', details: 'reason' }));
    await reportPost.run(req('bob', { postId: post.id, reason: 'spam', details: 'reason' }));
    expect((await db().collection('postReports').get()).size).toBe(1);
  });
  it('account erasure removes posts, comments, likes and private activity', async () => {
    const own = await createPost.run(req('alice', { clientId: 'erase', body: 'erase text', audience: 'public' }));
    const peer = await createPost.run(req('bob', { clientId: 'keep', body: 'keep text', audience: 'public' }));
    await setPostLike.run(req('alice', { postId: peer.post.id, active: true }));
    await addPostComment.run(req('alice', { postId: peer.post.id, clientId: 'erase-comment', text: 'erase comment' }));
    await setPostLike.run(req('bob', { postId: own.post.id, active: true }));
    await queueClipAccountErasure(db(), 'alice');
    for (let n = 0; n < 30 && (await db().doc('clipAccountErasureJobs/alice').get()).get('status') !== 'done'; n++) await processClipAccountErasure(db(), 'alice');
    expect((await db().doc(`posts/${own.post.id}`).get()).data()).toMatchObject({ status: 'removed', body: '' });
    expect((await db().doc(`posts/${peer.post.id}`).get()).data()).toMatchObject({ likeCount: 0, commentCount: 0 });
    expect((await db().collection('clipProfiles/alice/activity').get()).empty).toBe(true);
    expect((await db().collectionGroup('activity').where('actorUid', '==', 'alice').get()).empty).toBe(true);
  });
});
