import { beforeEach, describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import { db, resetEmulators, req } from './harness';
import { markStatusViewed } from '../src/statuses/markStatusViewed';
import { getStatus, setStatusLike, listStatusViewers, replyToStatus } from '../src/statuses/statusInteractions';
import { createStatus } from '../src/statuses/createStatus';
import { getStatusFeed } from '../src/statuses/getStatusFeed';
const story = () => db().doc('statuses/story');
beforeEach(async () => {
  await resetEmulators();
  for (const uid of ['owner', 'viewer', 'outsider']) await db().doc(`users/${uid}`).set({ displayName: uid.toUpperCase(), status: 'active', username: uid, photoURL: `https://avatar/${uid}` });
  await story().set({ authorId: 'owner', type: 'text', body: 'A story', audienceType: 'only_share_with', allowedViewerUids: ['viewer'], createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 60_000), viewCount: 0, likeCount: 0 });
});
describe('status interaction permissions and idempotency', () => {
  it('hides a suspended status from feeds and blocks direct access and interactions until restored', async () => {
    expect((await getStatusFeed.run(req('viewer', {}))).items).toHaveLength(1);
    await story().update({ moderationSuspended: true });
    expect((await getStatusFeed.run(req('viewer', {}))).items).toHaveLength(0);
    for (const operation of [
      () => getStatus.run(req('viewer', { statusId: 'story' })),
      () => markStatusViewed.run(req('viewer', { statusId: 'story' })),
      () => setStatusLike.run(req('viewer', { statusId: 'story', liked: true })),
      () => replyToStatus.run(req('viewer', { statusId: 'story', text: 'Hello', localId: 'reply-12345' })),
      () => listStatusViewers.run(req('owner', { statusId: 'story' })),
    ]) {
      await expect(operation()).rejects.toMatchObject({ code: 'not-found' });
    }
    expect((await story().get()).data()).toMatchObject({ viewCount: 0, likeCount: 0 });
    await story().update({ moderationSuspended: false });
    expect((await getStatus.run(req('viewer', { statusId: 'story' }))).item.statusId).toBe('story');
    expect((await getStatusFeed.run(req('viewer', {}))).items).toHaveLength(1);
  });
  it('counts concurrent repeated views once and exposes names/photos only to the owner', async () => {
    await Promise.all(Array.from({ length: 5 }, () => markStatusViewed.run(req('viewer', { statusId: 'story' }))));
    expect((await story().get()).get('viewCount')).toBe(1);
    await expect(listStatusViewers.run(req('viewer', { statusId: 'story' }))).rejects.toMatchObject({ code: 'permission-denied' });
    const page = await listStatusViewers.run(req('owner', { statusId: 'story' }));
    expect(page.viewers).toMatchObject([{ uid: 'viewer', name: 'VIEWER', photoURL: 'https://avatar/viewer', liked: false }]);
  });
  it('likes idempotently and removes the corresponding activity on unlike', async () => {
    await Promise.all(Array.from({ length: 4 }, () => setStatusLike.run(req('viewer', { statusId: 'story', liked: true }))));
    expect((await story().get()).get('likeCount')).toBe(1);
    expect((await db().collection('clipProfiles/owner/activity').get()).size).toBe(1);
    await setStatusLike.run(req('viewer', { statusId: 'story', liked: false }));
    await setStatusLike.run(req('viewer', { statusId: 'story', liked: false }));
    expect((await story().get()).get('likeCount')).toBe(0);
    expect((await db().collection('clipProfiles/owner/activity').get()).empty).toBe(true);
  });
  it('rejects excluded viewers, expired stories, blocked users and inactive accounts', async () => {
    const like = (uid = 'viewer') => setStatusLike.run(req(uid, { statusId: 'story', liked: true }));
    await expect(like('outsider')).rejects.toMatchObject({ code: 'permission-denied' });
    await db().doc('users/owner/blockedUsers/viewer').set({});
    await expect(like()).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(getStatus.run(req('viewer', { statusId: 'story' }))).rejects.toMatchObject({ code: 'permission-denied' });
    expect((await getStatusFeed.run(req('viewer', {}))).items).toHaveLength(0);
    await db().doc('users/owner/blockedUsers/viewer').delete();
    await db().doc('users/viewer').update({ status: 'disabled' }); await expect(like()).rejects.toMatchObject({ code: 'permission-denied' });
    await db().doc('users/viewer').update({ status: 'active' });
    await story().update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) }); await expect(like()).rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(replyToStatus.run(req('viewer', { statusId: 'story', text: 'hello', localId: 'reply-12345' }))).rejects.toMatchObject({ code: 'failed-precondition' });
    expect((await db().collection('conversations').get()).empty).toBe(true);
  });
  it('sends a private reply once through normal messaging and never copies media URLs', async () => {
    const input = { statusId: 'story', text: 'Hello', localId: 'reply-12345' };
    const first = await replyToStatus.run(req('viewer', input));
    const second = await replyToStatus.run(req('viewer', input));
    expect(second).toEqual(first);
    const messages = await db().collection(`conversations/${first.conversationId}/messages`).get();
    expect(messages.size).toBe(1); expect(messages.docs[0].get('text')).toBe('↩ A story\nHello');
    expect(messages.docs[0].get('senderUid')).toBe('viewer'); expect(messages.docs[0].get('media')).toBeUndefined();
    expect((await db().collection('clipProfiles/owner/activity').get()).size).toBe(1);
  });
  it('deduplicates concurrent first replies and keeps the same retry id independent across stories', async () => {
    const input = { statusId: 'story', text: 'Concurrent', localId: 'concurrent-12345' };
    const results = await Promise.all(Array.from({ length: 5 }, () => replyToStatus.run(req('viewer', input))));
    expect(new Set(results.map(r => r.conversationId)).size).toBe(1);
    expect(new Set(results.map(r => r.messageId)).size).toBe(1);
    expect((await db().collection('conversations').get()).size).toBe(1);
    await db().doc('statuses/second').set({ ...(await story().get()).data(), body: 'Another story' });
    const second = await replyToStatus.run(req('viewer', { ...input, statusId: 'second', text: 'Second' }));
    expect(second.conversationId).toBe(results[0].conversationId);
    expect(second.messageId).not.toBe(results[0].messageId);
    expect((await db().collection(`conversations/${second.conversationId}/messages`).get()).size).toBe(2);
  });
  it('stores validated mentions and rejects an audience-excluded or blocked mention', async () => {
    const input = { body: 'Hello', audienceType: 'only_share_with', allowedViewerUids: ['viewer'], mentionUids: ['viewer'] };
    const result = await createStatus.run(req('owner', input));
    const saved = await db().doc(`statuses/${result.statusId}`).get();
    expect(saved.get('mentions')).toEqual([{ uid: 'viewer', name: 'VIEWER', username: 'viewer' }]);
    expect((await db().collection('clipProfiles/viewer/activity').get()).size).toBe(1);
    await expect(createStatus.run(req('owner', { ...input, mentionUids: ['outsider'] }))).rejects.toThrow('mention-unavailable');
    await db().doc('users/viewer/blockedUsers/owner').set({});
    await expect(createStatus.run(req('owner', input))).rejects.toThrow('mention-unavailable');
  });
});
