import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, setDoc, Timestamp, updateDoc, where, type QuerySnapshot } from 'firebase/firestore';
import { deleteObject, getBytes, getDownloadURL, listAll, ref, updateMetadata, uploadBytes } from 'firebase/storage';

const hasStorage = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const bytes = new Uint8Array([1, 2, 3]);
const imagePath = `postMedia/owner/post/${'a'.repeat(64)}.jpg`;
const storageRules = readFileSync(resolve('storage.rules'), 'utf8');
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-offlinesms',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
    ...(hasStorage ? { storage: { host: '127.0.0.1', port: 9199, rules: storageRules } } : {}),
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore(); if (hasStorage) await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    for (const uid of ['owner', 'peer', 'outsider']) await setDoc(doc(db, `users/${uid}`), { status: 'active', disabled: false });
    const base = { authorId: 'owner', type: 'text', text: 'Private story', audienceType: 'only_share_with', allowedViewerUids: ['peer'], excludedViewerUids: [],
      createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 60_000), viewCount: 1, likeCount: 0, mentionUids: [] };
    await setDoc(doc(db, 'statuses/allowed'), base);
    await setDoc(doc(db, 'statuses/expired'), { ...base, expiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
    await setDoc(doc(db, 'statuses/excluded'), { ...base, audienceType: 'contacts_except', excludedViewerUids: ['peer'] });
    await setDoc(doc(db, 'statuses/allowed/views/peer'), { viewerUid: 'peer', viewedAt: Timestamp.now() });
    await setDoc(doc(db, 'statuses/allowed/likes/peer'), { createdAt: Timestamp.now() });
    await setDoc(doc(db, 'posts/post'), { ownerUid: 'owner', status: 'published', audience: 'public', body: 'Post', imagePath });
    await setDoc(doc(db, 'posts/post/comments/comment'), { authorUid: 'peer', text: 'Private raw comment' });
    await setDoc(doc(db, 'posts/post/likes/peer'), { createdAt: Timestamp.now() });
    await setDoc(doc(db, 'postReports/report'), { postId: 'post', reporterUid: 'peer', status: 'open', details: 'Private report' });
    await setDoc(doc(db, 'clipProfiles/owner'), { suspended: false, deleting: false });
    await setDoc(doc(db, 'clipProfiles/owner/activity/event'), { kind: 'statusLike', statusId: 'allowed', actorUid: 'peer', read: false });
  });
});
const mutate = async (path: string, data: Record<string, unknown>) => env.withSecurityRulesDisabled(async ctx => { await updateDoc(doc(ctx.firestore(), path), data); });

describe('status document audience and trusted interactions', () => {
  it('preserves the owner query and live updates even when own stories expire', async () => {
    const db = env.authenticatedContext('owner').firestore();
    const own = query(collection(db, 'statuses'), where('authorId', '==', 'owner'));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let receiveSnapshot: (snapshot: QuerySnapshot) => void;
    let rejectSnapshot: (error: Error) => void;
    const waitForServerCount = (expected: number) => new Promise<QuerySnapshot>((resolve, reject) => {
      rejectSnapshot = error => { clearTimeout(timeout); reject(error); };
      receiveSnapshot = snapshot => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
        if (snapshot.docs.find(row => row.id === 'allowed')?.get('viewCount') === expected) {
          clearTimeout(timeout); resolve(snapshot);
        }
      };
      timeout = setTimeout(() => rejectSnapshot(new Error(`Owner subscription did not receive server count ${expected}`)), 10_000);
    });
    // Use one watch for the initial query and mutation. getDocs followed by
    // onSnapshot rapidly unlistens/relistens and can trigger the emulator's
    // malformed gRPC frame bug: firebase/firebase-tools#8654.
    let release = () => {};
    try {
      const first = waitForServerCount(1);
      release = onSnapshot(own, { includeMetadataChanges: true },
        snapshot => receiveSnapshot(snapshot), error => rejectSnapshot(error));
      const initial = await first;
      expect(initial.docs.map(row => row.id).sort()).toEqual(['allowed', 'excluded', 'expired']);
      const live = waitForServerCount(2);
      await Promise.all([mutate('statuses/allowed', { viewCount: 2 }), live]);
    } finally { clearTimeout(timeout); release(); }
    await assertSucceeds(deleteDoc(doc(db, 'statuses/expired')));
  });

  it('allows an active audience member but denies an outsider, excluded viewer, expired story and anonymous client', async () => {
    const peer = env.authenticatedContext('peer').firestore();
    await assertSucceeds(getDoc(doc(peer, 'statuses/allowed')));
    await assertFails(getDoc(doc(peer, 'statuses/excluded')));
    await assertFails(getDoc(doc(peer, 'statuses/expired')));
    await assertFails(getDoc(doc(env.authenticatedContext('outsider').firestore(), 'statuses/allowed')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'statuses/allowed')));
    await assertFails(deleteDoc(doc(peer, 'statuses/allowed')));
    await assertFails(getDocs(collection(peer, 'statuses')));
  });

  it.each(['viewer', 'author'])('blocks story reads for a block created by the %s', async side => {
    const [blocker, blocked] = side === 'viewer' ? ['peer', 'owner'] : ['owner', 'peer'];
    await env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), `users/${blocker}/blockedUsers/${blocked}`), { createdAt: Timestamp.now() }); });
    await assertFails(getDoc(doc(env.authenticatedContext('peer').firestore(), 'statuses/allowed')));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('owner').firestore(), 'statuses/allowed')));
  });

  it.each([
    ['peer', { status: 'suspended' }], ['peer', { disabled: true }],
    ['owner', { status: 'suspended' }], ['owner', { disabled: true }],
    ['owner', { status: 'deleted' }],
  ] as const)('denies nonowner reads when %s has account state %j', async (uid, data) => {
    await mutate(`users/${uid}`, data);
    await assertFails(getDoc(doc(env.authenticatedContext('peer').firestore(), 'statuses/allowed')));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('owner').firestore(), 'statuses/allowed')));
  });

  it('does not trust clients to create or rewrite story author, audience, counts or mentions, including admin claims', async () => {
    for (const ctx of [env.authenticatedContext('owner'), env.authenticatedContext('peer'), env.authenticatedContext('admin', { admin: true, role: 'super_admin' })]) {
      const db = ctx.firestore();
      await assertFails(setDoc(doc(db, 'statuses/forged'), { authorId: 'owner', text: 'Forged story', audienceType: 'all_contacts', mentionUids: ['outsider'] }));
      for (const data of [{ authorId: 'peer' }, { audienceType: 'all_contacts', allowedViewerUids: [] }, { viewCount: 999, likeCount: 999 }, { mentionUids: ['outsider'] }]) {
        await assertFails(updateDoc(doc(db, 'statuses/allowed'), data));
      }
      await assertFails(setDoc(doc(db, 'statuses/allowed/views/forged'), { viewerUid: 'outsider', viewedAt: Timestamp.now() }));
      await assertFails(updateDoc(doc(db, 'statuses/allowed/views/peer'), { viewedAt: Timestamp.now() }));
      await assertFails(deleteDoc(doc(db, 'statuses/allowed/views/peer')));
    }
    const owner = env.authenticatedContext('owner').firestore(), peer = env.authenticatedContext('peer').firestore();
    await assertFails(setDoc(doc(peer, 'statuses/allowed/views/peer'), { viewedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(owner, 'statuses/allowed/likes/owner'), { createdAt: Timestamp.now() }));
    await assertFails(updateDoc(doc(peer, 'statuses/allowed/likes/peer'), { liked: false }));
    await assertFails(deleteDoc(doc(peer, 'statuses/allowed/likes/peer')));
  });

  it('keeps direct viewer rows restricted to the owner and the viewer itself', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext('owner').firestore(), 'statuses/allowed/views/peer')));
    await assertSucceeds(getDoc(doc(env.authenticatedContext('peer').firestore(), 'statuses/allowed/views/peer')));
    await assertFails(getDoc(doc(env.authenticatedContext('outsider').firestore(), 'statuses/allowed/views/peer')));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'statuses/allowed/views/peer')));
  });
});

describe('post and activity callable-only document boundary', () => {
  it('denies raw reads, list queries and every write for regular clients and admin claims', async () => {
    const paths = ['posts/post', 'posts/post/comments/comment', 'posts/post/likes/peer', 'postReports/report', 'clipProfiles/owner/activity/event'];
    for (const ctx of [env.authenticatedContext('owner'), env.authenticatedContext('peer'), env.unauthenticatedContext(),
      env.authenticatedContext('admin', { admin: true, role: 'super_admin' }), env.authenticatedContext('org', { admin: true, role: 'organization_admin', organizationId: 'org' })]) {
      const db = ctx.firestore();
      for (const path of paths) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { forged: true }));
        await assertFails(updateDoc(doc(db, path), { ownerUid: 'peer', status: 'published', read: true }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      for (const path of ['posts', 'posts/post/comments', 'posts/post/likes', 'postReports', 'clipProfiles/owner/activity']) await assertFails(getDocs(collection(db, path)));
      await assertFails(setDoc(doc(db, 'clipProfiles/owner/activity/forged'), { actorUid: 'admin', kind: 'statusMention', statusId: 'allowed', read: false }));
      await assertFails(setDoc(doc(db, 'posts/forged'), { ownerUid: 'owner', audience: 'public', status: 'published' }));
    }
  });
});

describe.skipIf(!hasStorage)('post storage privacy and existing media behavior', () => {
  it('denies direct read, upload, listing and mutation of private post images even for admin claims', async () => {
    await env.withSecurityRulesDisabled(async ctx => { await uploadBytes(ref(ctx.storage(), imagePath), bytes, { contentType: 'image/jpeg' }); });
    for (const ctx of [env.authenticatedContext('owner'), env.authenticatedContext('peer'), env.unauthenticatedContext(), env.authenticatedContext('admin', { admin: true, role: 'super_admin' })]) {
      const storage = ctx.storage();
      await assertFails(getBytes(ref(storage, imagePath)));
      await assertFails(getDownloadURL(ref(storage, imagePath)));
      await assertFails(uploadBytes(ref(storage, imagePath), bytes, { contentType: 'image/jpeg' }));
      await assertFails(uploadBytes(ref(storage, `postMedia/owner/forged/${'b'.repeat(64)}.jpg`), bytes, { contentType: 'image/jpeg' }));
      await assertFails(updateMetadata(ref(storage, imagePath), { customMetadata: { firebaseStorageDownloadTokens: 'forged' } }));
      await assertFails(deleteObject(ref(storage, imagePath)));
      await assertFails(listAll(ref(storage, 'postMedia/owner/post')));
    }
  });

  it('preserves own avatar/status uploads and signed-in reads while rejecting cross-owner writes and unsupported status MIME', async () => {
    const owner = env.authenticatedContext('owner').storage(), peer = env.authenticatedContext('peer').storage();
    for (const path of ['avatars/owner/avatar.jpg', 'statuses/owner/story.jpg']) {
      await assertSucceeds(uploadBytes(ref(owner, path), bytes, { contentType: 'image/jpeg' }));
      await assertSucceeds(getBytes(ref(peer, path)));
      await assertFails(uploadBytes(ref(peer, path), bytes, { contentType: 'image/jpeg' }));
      await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), path)));
    }
    await assertSucceeds(uploadBytes(ref(owner, 'statuses/owner/story.mp4'), bytes, { contentType: 'video/mp4' }));
    await assertFails(uploadBytes(ref(owner, 'statuses/owner/bad.html'), bytes, { contentType: 'text/html' }));
  });

  it('retains exactly two cross-service lookups for an existing reserved clip upload', async () => {
    const block = storageRules.slice(storageRules.indexOf('match /clipUploads/'), storageRules.indexOf('match /clipMedia/'));
    expect(block.match(/firestore\.get\(/g)).toHaveLength(2);
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'clips/reserved'), { ownerUid: 'owner', status: 'uploading', sourcePath: 'clipUploads/owner/reserved/source', maxUploadBytes: 10, uploadExpiresAt: Timestamp.fromMillis(Date.now() + 60_000) });
    });
    const source = ref(env.authenticatedContext('owner').storage(), 'clipUploads/owner/reserved/source');
    await assertSucceeds(uploadBytes(source, bytes, { contentType: 'video/mp4' }));
    await assertFails(getBytes(source));
  });
});
