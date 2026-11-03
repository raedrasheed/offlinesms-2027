import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getBytes, getDownloadURL, listAll, ref, updateMetadata, uploadBytes } from 'firebase/storage';

let env: RulesTestEnvironment;
const hasStorage = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const sourcePath = 'clipUploads/owner/clip-one/source';
const outputPath = 'clipMedia/owner/clip-one/standard.mp4';
const bytes = new Uint8Array([1, 2, 3]);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-offlinesms',
    firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
    ...(hasStorage ? { storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(resolve('storage.rules'), 'utf8') } } : {}),
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  if (hasStorage) await env.clearStorage();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'systemSettings/clips'), { enabled: true, moderationRequired: true, maxUploadMB: 80 });
    await setDoc(doc(db, 'systemSettings/general'), { appName: 'OfflineSMS' });
    await setDoc(doc(db, 'users/owner'), { displayName: 'Owner', status: 'active' });
    await setDoc(doc(db, 'clipProfiles/owner'), { termsVersion: 'clips-v1', privateAccount: false, suspended: false });
    await setDoc(doc(db, 'clips/clip-one'), {
      ownerUid: 'owner', audience: 'public', status: 'uploading', sourcePath,
      maxUploadBytes: 20, uploadExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    await setDoc(doc(db, 'clips/clip-one/comments/comment'), { authorUid: 'owner', text: 'Private raw comment' });
    await setDoc(doc(db, 'clips/clip-one/comments/comment/likes/owner'), { createdAt: Timestamp.now() });
    await setDoc(doc(db, 'clipProfiles/owner/followers/peer'), { status: 'accepted' });
    await setDoc(doc(db, 'clipProfiles/owner/saved/clip-one'), { createdAt: Timestamp.now() });
    await setDoc(doc(db, 'clipReports/report-one'), { clipId: 'clip-one', reporterUid: 'owner', details: 'Private report' });
  });
});

describe('Clips callable-only data boundary', () => {
  it('denies raw clip, comment, private follow/save and report reads for every client role', async () => {
    const contexts = [env.unauthenticatedContext(), env.authenticatedContext('owner'),
      env.authenticatedContext('peer'), env.authenticatedContext('admin', { admin: true, role: 'super_admin' }),
      env.authenticatedContext('org-admin', { admin: true, role: 'organization_admin', organizationId: 'org' })];
    for (const ctx of contexts) {
      const db = ctx.firestore();
      for (const path of ['clips/clip-one', 'clips/clip-one/comments/comment',
        'clips/clip-one/comments/comment/likes/owner', 'clipProfiles/owner',
        'clipProfiles/owner/followers/peer', 'clipProfiles/owner/saved/clip-one', 'clipReports/report-one', 'clipAccountErasureJobs/owner']) {
        await assertFails(getDoc(doc(db, path)));
      }
      await assertFails(getDocs(collection(db, 'clips')));
      await assertFails(getDocs(collection(db, 'clipProfiles/owner/followers')));
    }
  });

  it('prevents client forgery of publication, moderation, counters, following and terms', async () => {
    for (const claims of [{}, { admin: true, role: 'super_admin' }]) {
      const db = env.authenticatedContext('owner', claims).firestore();
      await assertFails(updateDoc(doc(db, 'clips/clip-one'), { status: 'published', audience: 'public', likeCount: 1000 }));
      await assertFails(deleteDoc(doc(db, 'clips/clip-one')));
      await assertFails(setDoc(doc(db, 'clips/forged'), { ownerUid: 'owner', status: 'published' }));
      await assertFails(setDoc(doc(db, 'clips/clip-one/comments/forged'), { authorUid: 'peer', text: 'Forged' }));
      await assertFails(setDoc(doc(db, 'clipProfiles/peer/followers/owner'), { status: 'accepted' }));
      await assertFails(updateDoc(doc(db, 'clipProfiles/owner'), { suspended: false, termsVersion: 'forged' }));
      await assertFails(setDoc(doc(db, 'clipReports/forged'), { clipId: 'clip-one' }));
    }
  });

  it('locks Clips policy to audited server actions while preserving general settings reads', async () => {
    for (const claims of [{}, { admin: true, role: 'super_admin' }, { admin: true, role: 'organization_admin' }]) {
      const db = env.authenticatedContext('owner', claims).firestore();
      await assertFails(getDoc(doc(db, 'systemSettings/clips')));
      await assertFails(updateDoc(doc(db, 'systemSettings/clips'), { moderationRequired: false, maxUploadMB: 9999 }));
      await assertSucceeds(getDoc(doc(db, 'systemSettings/general')));
    }
  });

  it('keeps existing profile edits but rejects new publication/admin privilege fields', async () => {
    const db = env.authenticatedContext('owner').firestore();
    await assertSucceeds(updateDoc(doc(db, 'users/owner'), { displayName: 'New owner' }));
    await assertFails(updateDoc(doc(db, 'users/owner'), { clipPublishingSuspended: false }));
    await assertFails(updateDoc(doc(db, 'users/owner'), { role: 'super_admin' }));
  });
});

describe.skipIf(!hasStorage)('Clips media storage boundary', () => {
  const storage = (uid = 'owner') => env.authenticatedContext(uid).storage();
  const upload = (uid = 'owner', path = sourcePath, contentType = 'video/mp4', body = bytes) =>
    uploadBytes(ref(storage(uid), path), body, { contentType });
  const mutate = async (path: string, data: Record<string, unknown>) => {
    await env.withSecurityRulesDisabled(async ctx => { await updateDoc(doc(ctx.firestore(), path), data); });
  };

  it('permits only the reserved owner source, including interrupted-upload replacement', async () => {
    await assertSucceeds(upload());
    await assertSucceeds(upload());
    await mutate('clips/clip-one', { status: 'failed' });
    await assertSucceeds(upload());
    await assertFails(upload('peer'));
    await assertFails(upload('owner', 'clipUploads/owner/unreserved/source'));
    await assertFails(upload('owner', sourcePath + '.mp4'));
    await assertFails(uploadBytes(ref(env.unauthenticatedContext().storage(), sourcePath), bytes, { contentType: 'video/mp4' }));
  });

  it('denies source overwrite after processing/publication and expired reservations', async () => {
    await assertSucceeds(upload());
    for (const status of ['processing', 'pending_review', 'published', 'rejected', 'removed']) {
      await mutate('clips/clip-one', { status });
      await assertFails(upload());
    }
    await mutate('clips/clip-one', { status: 'uploading', uploadExpiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await assertFails(upload());
  });

  it('checks live publisher suspension while honoring already-issued private source leases', async () => {
    // Cross-service Storage rules can read at most two Firestore documents.
    // Global disable/account status are rechecked at init, publish and playback;
    // an existing, expiring original-upload lease is never a publication grant.
    await mutate('systemSettings/clips', { enabled: false });
    await mutate('users/owner', { status: 'suspended', disabled: true });
    await assertSucceeds(upload());
    await mutate('clipProfiles/owner', { suspended: true });
    await assertFails(upload());
    await mutate('clipProfiles/owner', { suspended: false, deleting: true });
    await assertFails(upload());
  });

  it('rejects oversized/empty/nonvideo inputs, mismatched reservation paths and arbitrary metadata', async () => {
    await assertFails(upload('owner', sourcePath, 'video/mp4', new Uint8Array(21)));
    await assertFails(upload('owner', sourcePath, 'video/mp4', new Uint8Array(0)));
    await assertFails(upload('owner', sourcePath, 'image/jpeg'));
    await assertFails(upload('owner', sourcePath, 'application/octet-stream'));
    await assertFails(uploadBytes(ref(storage(), sourcePath), bytes, {
      contentType: 'video/mp4', customMetadata: { access: 'public' },
    }));
    await mutate('clips/clip-one', { sourcePath: 'clipUploads/other/clip-one/source' });
    await assertFails(upload());
  });

  it('denies source SDK reads/list/deletes and freezes metadata when processing begins', async () => {
    await assertSucceeds(upload());
    // Token metadata is reserved by Firebase and hidden from rules. Publication
    // freezes this object before server code removes its upload-time token.
    await mutate('clips/clip-one', { status: 'processing' });
    for (const uid of ['owner', 'peer']) {
      await assertFails(getBytes(ref(storage(uid), sourcePath)));
      await assertFails(getDownloadURL(ref(storage(uid), sourcePath)));
      await assertFails(listAll(ref(storage(uid), 'clipUploads/owner/clip-one')));
      await assertFails(deleteObject(ref(storage(uid), sourcePath)));
      await assertFails(updateMetadata(ref(storage(uid), sourcePath), { customMetadata: { firebaseStorageDownloadTokens: 'forged' } }));
    }
  });

  it('keeps processed files server-only even for owners and admin-claim clients', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await uploadBytes(ref(ctx.storage(), outputPath), bytes, { contentType: 'video/mp4' });
    });
    const contexts = [env.authenticatedContext('owner'), env.authenticatedContext('peer'),
      env.authenticatedContext('admin', { admin: true, role: 'super_admin' }), env.unauthenticatedContext()];
    for (const ctx of contexts) {
      const s = ctx.storage();
      await assertFails(getBytes(ref(s, outputPath)));
      await assertFails(getDownloadURL(ref(s, outputPath)));
      await assertFails(uploadBytes(ref(s, outputPath), bytes, { contentType: 'video/mp4' }));
      await assertFails(deleteObject(ref(s, outputPath)));
      await assertFails(updateMetadata(ref(s, outputPath), { customMetadata: { firebaseStorageDownloadTokens: 'forged' } }));
    }
  });
});
