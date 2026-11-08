import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, req, resetEmulators, Timestamp, expectHttps } from './harness';
import {
  getClipsConfig, acceptClipsTerms, getClip, getClipsFeed, getClipProfile, updateClipProfile,
  updateClip, deleteClip, followClipCreator, respondClipFollowRequest, removeClipFollower,
  listClipFollowRequests, listClipFollowers, setClipInteraction, recordClipView, reportClip,
  addClipComment, listClipComments, deleteClipComment, setClipCommentLike, shareClip,
} from '../src/clips/core';
import { canViewClip, isPlatformClipAdmin, consumeClipRate } from '../src/clips/access';
import { clipsConfig, validateClipMetadata, encodeClipCursor, decodeClipCursor, type ClipDoc } from '../src/clips/model';

const createdAt = Timestamp.fromMillis(1_700_000_000_000);
async function seedUser(uid: string, profile: Record<string, unknown> = {}) {
  await db().doc(`users/${uid}`).set({ displayName: uid, username: `${uid}_public`, status: 'active', phoneNumber: '+19995551234' });
  await db().doc(`clipProfiles/${uid}`).set({ termsVersion: 'clips-v1', privateAccount: false, followerCount: 0, followingCount: 0, ...profile });
}
async function seedClip(id = 'video', changes: Record<string, unknown> = {}) {
  const data = { ownerUid: 'alice', status: 'published', audience: 'public', caption: 'Coffee #قهوة',
    hashtags: ['قهوة'], groupId: null, allowComments: true, allowDownload: false, likeCount: 0,
    commentCount: 0, viewCount: 0, shareCount: 0, createdAt, publishedAt: createdAt,
    sourcePath: 'clipUploads/alice/video/source', standardPath: 'clipMedia/alice/video/standard.mp4',
    ...changes };
  await db().doc(`clips/${id}`).set(data); return data as ClipDoc;
}
async function group(status = 'active', memberStatus = 'active') {
  await db().doc('conversations/group').set({ type: 'group', participantUids: ['alice', 'bob'], status, settings: {} });
  await db().doc('conversations/group/members/alice').set({ role: 'owner', status: 'active' });
  await db().doc('conversations/group/members/bob').set({ role: 'member', status: memberStatus });
}
async function clipCount(field: string) { return (await db().doc('clips/video').get()).get(field); }

beforeEach(async () => {
  await resetEmulators();
  await db().doc('systemSettings/clips').set({ enabled: true, moderationRequired: true, termsVersion: 'clips-v1' });
  await Promise.all(['alice', 'bob', 'carol'].map(uid => seedUser(uid)));
});

describe('Clips validation and server configuration', () => {
  it('defaults to gated rollout, clamps limits, and rejects malformed cursors and metadata', () => {
    expect(clipsConfig()).toMatchObject({ enabled: false, moderationRequired: true, maxDurationSeconds: 60, maxUploadMB: 80 });
    expect(clipsConfig({ maxUploadMB: 999, maxDurationSeconds: 999 })).toMatchObject({ maxUploadMB: 200, maxDurationSeconds: 180 });
    expect(validateClipMetadata({ caption: ' #قهوة #قهوة #Coffee ', audience: 'public', allowComments: true, allowDownload: false }).hashtags).toEqual(['قهوة', 'coffee']);
    expect(() => validateClipMetadata({ audience: 'group', allowComments: true, allowDownload: false })).toThrow();
    expect(() => validateClipMetadata({ audience: 'public', caption: 'x'.repeat(2201), allowComments: true, allowDownload: false })).toThrow();
    const cursor = encodeClipCursor(createdAt, 'video');
    expect(decodeClipCursor(cursor)).toEqual([createdAt.seconds, createdAt.nanoseconds, 'video']);
    expect(() => decodeClipCursor('not-a-cursor')).toThrow();
    expect(() => decodeClipCursor(Buffer.from(JSON.stringify([253402300800, 0, 'x'])).toString('base64url'))).toThrow();
    expect(() => decodeClipCursor(Buffer.from(JSON.stringify([-1, 0, 'x'])).toString('base64url'))).toThrow();
  });
  it('requires current accepted terms for posting and blocks disabled rollout reads', async () => {
    await seedClip(); await db().doc('clipProfiles/bob').update({ termsVersion: 'old' });
    expect((await getClipsConfig.run(req('bob', {}))).termsAccepted).toBe(false);
    await expectHttps(setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: true })), 'failed-precondition', 'clips-terms-required');
    await expectHttps(acceptClipsTerms.run(req('bob', { version: 'old' })), 'failed-precondition');
    await expectHttps(acceptClipsTerms.run(req('bob', { version: 'clips-v1', expectedUid: 'alice' })), 'failed-precondition', 'clips-account-changed');
    expect((await db().doc('clipProfiles/bob').get()).get('termsVersion')).toBe('old');
    await acceptClipsTerms.run(req('bob', { version: 'clips-v1' }));
    await setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: true }));
    await db().doc('systemSettings/clips').update({ enabled: false });
    await expectHttps(getClip.run(req('bob', { clipId: 'video' })), 'failed-precondition', 'clips-disabled');
    // Owners can still erase their content while the feature is disabled.
    await deleteClip.run(req('alice', { clipId: 'video' })); expect(await clipCount('status')).toBe('removed');
  });
  it('does not elevate organization or support admin claims to content administrator', () => {
    expect(isPlatformClipAdmin({ role: 'super_admin' })).toBe(true);
    expect(isPlatformClipAdmin({ admin: true })).toBe(true);
    expect(isPlatformClipAdmin({ admin: true, role: 'support' })).toBe(false);
    expect(isPlatformClipAdmin({ admin: true, organizationId: 'org' })).toBe(false);
    expect(isPlatformClipAdmin({ admin: true, roles: ['organization_admin'] })).toBe(false);
  });
});

describe('Clips access and privacy', () => {
  it('hides unpublished, private, deleted-owner, and suspended-owner content', async () => {
    for (const status of ['uploading', 'processing', 'failed', 'pending_review', 'rejected']) {
      const c = await seedClip('video', { status });
      expect(await canViewClip(db(), c, 'bob')).toBe(false);
      expect(await canViewClip(db(), c, 'alice')).toBe(true);
    }
    const privateClip = await seedClip('video', { audience: 'private' });
    expect(await canViewClip(db(), privateClip, 'bob')).toBe(false);
    await db().doc('users/alice').delete();
    expect(await canViewClip(db(), privateClip, 'alice')).toBe(false);
    await seedUser('alice', { deleting: true });
    expect(await canViewClip(db(), privateClip, 'alice')).toBe(false);
    await seedUser('alice', { suspended: true });
    await expectHttps(getClip.run(req('bob', { clipId: 'video' })), 'not-found');
  });
  it('rejects actor erasure occurring after the outer check but before a mutation transaction', async () => {
    await seedClip();
    // Inject the deletion tombstone at the transaction boundary, after the
    // callable's first active-account check has already succeeded.
    const cases = [
      { at: 1, run: () => acceptClipsTerms.run(req('bob', { version: 'clips-v1' })) },
      { at: 1, run: () => updateClipProfile.run(req('bob', { bio: 'must not return after erasure' })) },
      { at: 2, run: () => setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: true })) },
      { at: 1, run: () => recordClipView.run(req('bob', { clipId: 'video' })) },
    ];
    for (const entry of cases) {
      await seedUser('bob');
      const firestore = db(), original = firestore.runTransaction.bind(firestore); let calls = 0;
      const spy = vi.spyOn(firestore, 'runTransaction').mockImplementation(async (...args: Parameters<typeof original>) => {
        if (++calls === entry.at) await firestore.doc('clipProfiles/bob').set({ deleting: true, suspended: true });
        return original(...args);
      });
      try { await expectHttps(entry.run(), 'permission-denied', 'clips-account-suspended'); }
      finally { spy.mockRestore(); }
      expect((await db().doc('clipProfiles/bob').get()).data()).toEqual({ deleting: true, suspended: true });
    }
    expect(await clipCount('likeCount')).toBe(0); expect(await clipCount('viewCount')).toBe(0);
    expect((await db().doc('clips/video/likes/bob').get()).exists).toBe(false);
  });
  it('checks blocks in both directions across details, interactions, comments and profiles', async () => {
    await seedClip();
    for (const [a, b] of [['alice', 'bob'], ['bob', 'alice']]) {
      await db().doc(`users/${a}/blockedUsers/${b}`).set({});
      await expectHttps(getClip.run(req('bob', { clipId: 'video' })), 'not-found');
      await expectHttps(setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: true })), 'not-found');
      await expectHttps(addClipComment.run(req('bob', { clipId: 'video', text: 'hello', clientId: 'test' })), 'not-found');
      await expectHttps(getClipProfile.run(req('bob', { uid: 'alice' })), 'not-found');
      expect((await getClipsFeed.run(req('bob', {}))).items).toEqual([]);
      await db().doc(`users/${a}/blockedUsers/${b}`).delete();
    }
    expect(await clipCount('likeCount')).toBe(0);
  });
  it('requires both group roster and live active membership, including after saving', async () => {
    await group(); await seedClip('video', { audience: 'group', groupId: 'group' });
    await setClipInteraction.run(req('bob', { clipId: 'video', type: 'save', active: true }));
    expect((await getClipsFeed.run(req('bob', { mode: 'saved' }))).items).toHaveLength(1);
    await db().doc('conversations/group/members/bob').update({ status: 'removed' });
    await expectHttps(getClip.run(req('bob', { clipId: 'video' })), 'not-found');
    expect((await getClipsFeed.run(req('bob', { mode: 'saved' }))).items).toEqual([]);
    await db().doc('conversations/group/members/bob').update({ status: 'active' });
    await db().doc('conversations/group').update({ participantUids: ['alice'] });
    await expectHttps(getClip.run(req('bob', { clipId: 'video' })), 'not-found');
  });
  it('private accounts require approval even for public clips and mirror counts only once', async () => {
    await seedClip(); await updateClipProfile.run(req('alice', { privateAccount: true }));
    expect((await followClipCreator.run(req('bob', { uid: 'alice', following: true }))).status).toBe('pending');
    await followClipCreator.run(req('bob', { uid: 'alice', following: true }));
    expect((await listClipFollowRequests.run(req('alice', {}))).items.map(x => x.uid)).toEqual(['bob']);
    expect((await db().doc('clipProfiles/alice').get()).get('followerCount')).toBe(0);
    await expectHttps(getClip.run(req('bob', { clipId: 'video' })), 'not-found');
    await respondClipFollowRequest.run(req('alice', { uid: 'bob', accept: true }));
    await respondClipFollowRequest.run(req('alice', { uid: 'bob', accept: true }));
    expect((await listClipFollowers.run(req('alice', {}))).items.map(x => x.uid)).toEqual(['bob']);
    expect((await getClip.run(req('bob', { clipId: 'video' }))).clip.followStatus).toBe('accepted');
    expect((await db().doc('clipProfiles/alice').get()).get('followerCount')).toBe(1);
    expect((await db().doc('clipProfiles/bob').get()).get('followingCount')).toBe(1);
    await removeClipFollower.run(req('alice', { uid: 'bob' })); await removeClipFollower.run(req('alice', { uid: 'bob' }));
    expect((await db().doc('clipProfiles/bob/following/alice').get()).exists).toBe(false);
    expect((await db().doc('clipProfiles/alice').get()).get('followerCount')).toBe(0);
    await expectHttps(getClip.run(req('bob', { clipId: 'video' })), 'not-found');
  });
  it('declines private follow requests and rejects disabled targets or blocked approval', async () => {
    await db().doc('clipProfiles/alice').update({ privateAccount: true });
    await followClipCreator.run(req('bob', { uid: 'alice', following: true }));
    await respondClipFollowRequest.run(req('alice', { uid: 'bob', accept: false }));
    expect((await db().doc('clipProfiles/alice/followers/bob').get()).exists).toBe(false);
    await followClipCreator.run(req('bob', { uid: 'alice', following: true }));
    await db().doc('users/bob/blockedUsers/alice').set({});
    await expectHttps(respondClipFollowRequest.run(req('alice', { uid: 'bob', accept: true })), 'permission-denied');
    await db().doc('users/alice').update({ disabled: true });
    await expectHttps(followClipCreator.run(req('carol', { uid: 'alice', following: true })), 'not-found');
  });
  it('returns safe DTOs and private counts without storage paths or phone numbers', async () => {
    await seedClip('video', { likeCount: 3 }); await seedClip('secret', { audience: 'private', likeCount: 100 });
    const detail = await getClip.run(req('bob', { clipId: 'video' }));
    expect(JSON.stringify(detail)).not.toMatch(/clipUploads|clipMedia|19995551234|sourcePath|standardPath/);
    expect((await getClipProfile.run(req('bob', { uid: 'alice' }))).profile).toMatchObject({ clipCount: 1, likeCount: 3 });
    expect((await getClipProfile.run(req('alice', { uid: 'alice' }))).profile).toMatchObject({ clipCount: 2, likeCount: 103 });
  });
});

describe('Clips pagination and moderation', () => {
  it('keeps newest clips first across pages regardless of engagement', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, index) => seedClip(`fresh${String(index).padStart(2, '0')}`, {
      createdAt: Timestamp.fromMillis(createdAt.toMillis() + index * 1000),
      likeCount: index === 0 ? 100_000 : 0, commentCount: index === 0 ? 50_000 : 0,
    })));
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await getClipsFeed.run(req('bob', { limit: 5, ...(cursor ? { cursor } : {}) }));
      ids.push(...page.items.map(item => item.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 12 }, (_, index) => `fresh${String(11 - index).padStart(2, '0')}`));
  });
  it('does not skip prefetched rows when a filtered batch fills a page partway through', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => seedClip(`batch${index}`, {
      createdAt: Timestamp.fromMillis(createdAt.toMillis() + 1000 - index),
      audience: index < 2 ? 'private' : 'public',
    })));
    const first = await getClipsFeed.run(req('bob', { limit: 3 }));
    const second = await getClipsFeed.run(req('bob', { limit: 3, cursor: first.nextCursor }));
    const third = await getClipsFeed.run(req('bob', { limit: 3, cursor: second.nextCursor }));
    expect([...first.items, ...second.items, ...third.items].map(item => item.id))
      .toEqual(['batch2', 'batch3', 'batch4', 'batch5', 'batch6', 'batch7', 'batch8', 'batch9']);
    expect(third.nextCursor).toBeNull();
  });
  it('advances the cursor through a completely filtered scan window', async () => {
    const batch = db().batch();
    for (let i = 0; i < 92; i++) batch.set(db().doc(`clips/row${String(i).padStart(3, '0')}`), {
      ownerUid: 'alice', status: 'published', audience: i < 90 ? 'private' : 'public', caption: 'visible',
      createdAt: Timestamp.fromMillis(createdAt.toMillis() + 1000 - i), allowComments: true,
    });
    await batch.commit();
    const first = await getClipsFeed.run(req('bob', { limit: 5 }));
    expect(first.items).toEqual([]); expect(first.nextCursor).toBeTruthy();
    const next = await getClipsFeed.run(req('bob', { limit: 5, cursor: first.nextCursor }));
    expect(next.items.map(x => x.id)).toEqual(['row090', 'row091']); expect(next.nextCursor).toBeNull();
  });
  it('paginates equal timestamps without duplication and searches Unicode hashtags', async () => {
    await Promise.all(['a', 'b', 'c'].map(id => seedClip(id)));
    const first = await getClipsFeed.run(req('bob', { limit: 2, query: '#قهوة' }));
    const second = await getClipsFeed.run(req('bob', { limit: 2, query: '#قهوة', cursor: first.nextCursor }));
    expect(new Set([...first.items, ...second.items].map(x => x.id)).size).toBe(3);
    expect(second.nextCursor).toBeNull();
    await setClipInteraction.run(req('bob', { clipId: 'a', type: 'hide', active: true }));
    expect((await getClipsFeed.run(req('bob', {}))).items.map(x => x.id)).not.toContain('a');
  });
  it('routes edits affecting reviewed content back to moderation and prevents foreign edits', async () => {
    await seedClip(); await updateClip.run(req('alice', { clipId: 'video', allowDownload: true }));
    expect(await clipCount('status')).toBe('published');
    await updateClip.run(req('alice', { clipId: 'video', caption: 'changed caption' }));
    expect(await clipCount('status')).toBe('pending_review');
    await expectHttps(getClip.run(req('bob', { clipId: 'video' })), 'not-found');
    await expectHttps(updateClip.run(req('bob', { clipId: 'video', caption: 'attack' })), 'not-found');
    await expectHttps(updateClip.run(req('alice', { clipId: 'video', audience: 'group', groupId: 'missing' })), 'permission-denied');
  });
});

describe('Clips interactions, comments and safe sharing', () => {
  it('deduplicates likes, saves and views under repeated requests', async () => {
    await seedClip();
    await Promise.all(Array.from({ length: 4 }, () => setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: true }))));
    expect(await clipCount('likeCount')).toBe(1);
    await setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: false }));
    await setClipInteraction.run(req('bob', { clipId: 'video', type: 'like', active: false }));
    expect(await clipCount('likeCount')).toBe(0);
    for (let i = 0; i < 2; i++) await setClipInteraction.run(req('bob', { clipId: 'video', type: 'save', active: true }));
    expect((await db().collection('clipProfiles/bob/saved').get()).size).toBe(1);
    expect((await db().doc('clips/video/saves/bob').get()).exists).toBe(true);
    await Promise.all([recordClipView.run(req('bob', { clipId: 'video' })), recordClipView.run(req('bob', { clipId: 'video' }))]);
    await recordClipView.run(req('alice', { clipId: 'video' })); expect(await clipCount('viewCount')).toBe(1);
  });
  it('supports idempotent comments and one-level replies, likes and deletion counters', async () => {
    await seedClip();
    const root = await addClipComment.run(req('bob', { clipId: 'video', text: 'hello', clientId: 'root' }));
    expect(await addClipComment.run(req('bob', { clipId: 'video', text: 'hello', clientId: 'root' }))).toEqual(root);
    const reply = await addClipComment.run(req('carol', { clipId: 'video', text: 'reply', parentId: root.commentId, clientId: 'reply' }));
    await expectHttps(addClipComment.run(req('bob', { clipId: 'video', text: 'nested', parentId: reply.commentId, clientId: 'nested' })), 'failed-precondition');
    expect(await clipCount('commentCount')).toBe(2);
    await setClipCommentLike.run(req('alice', { clipId: 'video', commentId: root.commentId, active: true }));
    await setClipCommentLike.run(req('alice', { clipId: 'video', commentId: root.commentId, active: true }));
    const listed = await listClipComments.run(req('alice', { clipId: 'video' }));
    expect(listed.items).toHaveLength(1); expect(listed.items[0]).toMatchObject({ replyCount: 1, likeCount: 1, likedByMe: true, canDelete: true });
    await expectHttps(deleteClipComment.run(req('bob', { clipId: 'video', commentId: reply.commentId })), 'permission-denied');
    await deleteClipComment.run(req('alice', { clipId: 'video', commentId: reply.commentId }));
    await deleteClipComment.run(req('alice', { clipId: 'video', commentId: reply.commentId }));
    expect(await clipCount('commentCount')).toBe(1);
    expect((await db().doc(`clips/video/comments/${root.commentId}`).get()).get('replyCount')).toBe(0);
    expect((await listClipComments.run(req('bob', { clipId: 'video', parentId: root.commentId }))).items[0]).toMatchObject({ deleted: true, text: '' });
    // Erasing an author must preserve the root so other people's replies remain reachable.
    await db().doc(`clips/video/comments/${root.commentId}`).update({ authorUid: null, deleted: true, text: '' });
    expect((await listClipComments.run(req('carol', { clipId: 'video' }))).items[0]).toMatchObject({ authorUid: '', deleted: true, author: { uid: '', displayName: '' } });
  });
  it('enforces comment disable, block filtering, and a server comment cap', async () => {
    await seedClip('video', { allowComments: false });
    await expectHttps(addClipComment.run(req('bob', { clipId: 'video', text: 'no', clientId: 'disabled' })), 'failed-precondition');
    await db().doc('clips/video').update({ allowComments: true });
    await addClipComment.run(req('carol', { clipId: 'video', text: 'hidden', clientId: 'hidden' }));
    await db().doc('users/bob/blockedUsers/carol').set({});
    expect((await listClipComments.run(req('bob', { clipId: 'video' }))).items).toEqual([]);
    await db().doc('clipProfiles/bob/rateLimits/comment').set({ windowStartMs: Date.now(), count: 15 });
    await expectHttps(addClipComment.run(req('bob', { clipId: 'video', text: 'spam', clientId: 'spam' })), 'resource-exhausted');
    expect(await clipCount('commentCount')).toBe(1);
  });
  it('deduplicates reports, validates comment targets and rate caps concurrent requests', async () => {
    await seedClip();
    const a = await reportClip.run(req('bob', { clipId: 'video', reason: 'spam' }));
    const b = await reportClip.run(req('bob', { clipId: 'video', reason: 'abuse' })); expect(a).toEqual(b);
    expect((await db().collection('clipReports').get()).size).toBe(1);
    await expectHttps(reportClip.run(req('bob', { clipId: 'video', commentId: 'missing', reason: 'spam' })), 'not-found');
    const calls = await Promise.allSettled(Array.from({ length: 5 }, () => consumeClipRate(db(), 'bob', 'cap', 3)));
    expect(calls.filter(x => x.status === 'fulfilled')).toHaveLength(3);
    expect((await db().doc('clipProfiles/bob/rateLimits/cap').get()).get('count')).toBe(3);
  });
  it('shares opaque references once and enforces direct blocks and group write permission', async () => {
    await seedClip('video', { audience: 'followers', caption: 'private caption' });
    await followClipCreator.run(req('bob', { uid: 'alice', following: true }));
    await db().doc('conversations/direct').set({ type: 'direct', participantUids: ['bob', 'carol'] });
    const input = { clipId: 'video', conversationId: 'direct', clientId: 'share1' };
    const a = await shareClip.run(req('bob', input)); const b = await shareClip.run(req('bob', input)); expect(a).toEqual(b);
    expect(await clipCount('shareCount')).toBe(1);
    const msg = (await db().doc(`conversations/direct/messages/${a.messageId}`).get()).data();
    expect(msg).toMatchObject({ type: 'clip', clipId: 'video', text: '🎬 OfflineSMS Clip' });
    expect(JSON.stringify(msg)).not.toMatch(/private caption|clipMedia|clipUploads|alice|19995551234/);
    await expectHttps(getClip.run(req('carol', { clipId: 'video' })), 'not-found');
    await db().doc('users/carol/blockedUsers/bob').set({});
    await expectHttps(shareClip.run(req('bob', { ...input, clientId: 'blocked' })), 'permission-denied');
    await group('locked');
    await expectHttps(shareClip.run(req('bob', { ...input, conversationId: 'group', clientId: 'locked' })), 'permission-denied');
    await db().doc('conversations/group').update({ status: 'active' });
    await db().doc('conversations/group/members/bob').update({ status: 'removed' });
    await expectHttps(shareClip.run(req('bob', { ...input, conversationId: 'group', clientId: 'removed' })), 'permission-denied');
  });
});

