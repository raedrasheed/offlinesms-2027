import { beforeEach, describe, expect, it } from 'vitest';
import { db, req, resetEmulators, Timestamp } from './harness';
import { createPost, getPost, listPosts, deletePost, setPostLike, listPostComments, addPostComment, deletePostComment, reportPost } from '../src/social/posts';
import { listSocialActivity } from '../src/social/activity';
import { writeSocialActivity } from '../src/social/activityModel';

beforeEach(async () => {
  await resetEmulators();
  await db().doc('systemSettings/clips').set({ enabled: true, moderationRequired: false, termsVersion: 'clips-v1' });
  for (const uid of ['alice', 'bob']) {
    await db().doc(`users/${uid}`).set({ status: 'active', displayName: uid });
    await db().doc(`clipProfiles/${uid}`).set({ termsVersion: 'clips-v1' });
  }
  await db().doc('posts/legacy').set({ ownerUid: 'alice', body: 'retained content', status: 'published', audience: 'public',
    imagePath: `postMedia/alice/legacy/${'a'.repeat(64)}.jpg`, likeCount: 0, commentCount: 0 });
});
describe('Posts are disabled independently of the Clips setting', () => {
  const operations = { createPost, getPost, listPosts, deletePost, setPostLike, listPostComments, addPostComment, deletePostComment, reportPost };
  for (const [name, callable] of Object.entries(operations)) it(`refuses ${name} before its business operation`, async () => {
    await expect(callable.run(req('alice', { postId: 'legacy', clientId: 'new', commentId: 'old', body: 'new text', audience: 'public', active: true, text: 'new comment', reason: 'spam' })))
      .rejects.toMatchObject({ code: 'failed-precondition', message: 'posts-disabled' });
    expect((await db().doc('posts/legacy').get()).data()).toMatchObject({ body: 'retained content', status: 'published', likeCount: 0, commentCount: 0 });
    expect((await db().collection('posts').get()).size).toBe(1);
    expect((await db().collection('postReports').get()).size).toBe(0);
  });
  it('hides existing post activity while returning valid clip notifications', async () => {
    await db().doc('clips/video').set({ ownerUid: 'alice', status: 'published', audience: 'public' });
    await db().doc('clips/video/likes/bob').set({ uid: 'bob' });
    for (const [id, target] of [['post', { kind: 'postLike', postId: 'legacy' }], ['comment', { kind: 'postComment', postId: 'legacy', commentId: 'old' }], ['video', { kind: 'like', clipId: 'video' }]] as const)
      await db().doc(`clipProfiles/alice/activity/${id}`).set({ ...target, actorUid: 'bob', createdAt: Timestamp.now(), readAt: null });
    expect((await listSocialActivity.run(req('alice', {}))).items.map(item => item.kind)).toEqual(['like']);
  });
  it('suppresses new post activity while continuing to write clip activity', async () => {
    await db().runTransaction(async tx => {
      writeSocialActivity(db(), tx, 'alice', { kind: 'postLike', actorUid: 'bob', postId: 'legacy' });
      writeSocialActivity(db(), tx, 'alice', { kind: 'like', actorUid: 'bob', clipId: 'video' });
    });
    const inbox = await db().collection('clipProfiles/alice/activity').get();
    expect(inbox.docs.map(row => row.get('kind'))).toEqual(['like']);
  });
});
