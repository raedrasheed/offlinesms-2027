import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

let env: RulesTestEnvironment;
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const path = (cid: string, id = 'pending') => `chatMedia/${cid}/sender/${id}/image-original.png`;
const storage = (uid: string | null) => uid ? env.authenticatedContext(uid).storage() : env.unauthenticatedContext().storage();
const upload = (cid: string, uid: string | null = 'sender') =>
  uploadBytes(ref(storage(uid), path(cid)), bytes, { contentType: 'image/png' });
const read = (cid: string, uid: string | null = 'peer') => getBytes(ref(storage(uid), path(cid, 'uploaded')));

async function seed(cid: string, conversation: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async ctx => {
    await setDoc(doc(ctx.firestore(), `conversations/${cid}`), conversation);
    for (const [uid, status] of [['sender', 'active'], ['peer', 'active'], ['removed', 'removed'], ['left', 'left']]) {
      await setDoc(doc(ctx.firestore(), `conversations/${cid}/members/${uid}`), { status });
    }
    for (const id of ['pending', 'uploaded']) {
      await setDoc(doc(ctx.firestore(), `conversations/${cid}/messages/${id}`), {
        senderUid: 'sender', type: 'image',
        media: { storagePath: path(cid, id), mimeType: 'image/png', sizeBytes: bytes.length, uploadStatus: id },
      });
    }
    await uploadBytes(ref(ctx.storage(), path(cid, 'uploaded')), bytes, { contentType: 'image/png' });
  });
}

describe.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('versioned group media ACL', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: 'demo-offlinesms',
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
      storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(resolve('storage.rules'), 'utf8') },
    });
  });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => { await env.clearFirestore(); await env.clearStorage(); });

  it('allows reconciled active members and rejects invitations, removed members and stale memberIds', async () => {
    await seed('reconciled', {
      type: 'group', mediaAclVersion: 2, participantUids: ['sender', 'peer'],
      memberIds: ['sender', 'peer', 'removed', 'left', 'pending'],
    });
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'users/pending/groupInvitations/reconciled'), { status: 'pending' });
    });
    await assertSucceeds(upload('reconciled'));
    await assertSucceeds(read('reconciled'));
    for (const uid of ['removed', 'left', 'pending', 'outsider', null]) {
      await assertFails(read('reconciled', uid));
      await assertFails(upload('reconciled', uid));
    }
  });

  it.each([undefined, 1, 3])('fails closed for unreconciled groups with ACL version %s and stale participant arrays', async version => {
    await seed('legacy', {
      type: 'group', participantUids: ['sender', 'peer', 'removed', 'left'],
      ...(version === undefined ? {} : { mediaAclVersion: version }),
    });
    await assertFails(upload('legacy'));
    for (const uid of ['peer', 'removed', 'left']) await assertFails(read('legacy', uid));
  });

  it('preserves direct chat membership without requiring group member records', async () => {
    await seed('direct', { type: 'direct', participantUids: ['sender', 'peer'], memberIds: ['outsider'] });
    await env.withSecurityRulesDisabled(async ctx => {
      for (const uid of ['sender', 'peer']) await deleteDoc(doc(ctx.firestore(), `conversations/direct/members/${uid}`));
      // Non-group legacy member records are self-writable; they cannot grant
      // Storage access to a user missing from the conversation participants.
      await setDoc(doc(ctx.firestore(), 'conversations/direct/members/outsider'), { status: 'active' });
    });
    await assertSucceeds(upload('direct'));
    await assertSucceeds(read('direct'));
    await assertFails(read('direct', 'outsider'));
  });

  it('keeps the legacy direct memberIds fallback but never overrides an explicit participant list', async () => {
    await seed('legacy-direct', { memberIds: ['sender', 'peer'] });
    await assertSucceeds(upload('legacy-direct'));
    await assertSucceeds(read('legacy-direct'));
    await env.withSecurityRulesDisabled(async ctx => {
      await updateDoc(doc(ctx.firestore(), 'conversations/legacy-direct'), { participantUids: [] });
    });
    await assertFails(read('legacy-direct'));
  });

  it('revokes reads when the conversation disappears, even with active orphaned member docs', async () => {
    await seed('deleted-parent', { type: 'group', mediaAclVersion: 2, participantUids: ['sender', 'peer'] });
    await assertSucceeds(read('deleted-parent'));
    await env.withSecurityRulesDisabled(async ctx => {
      await deleteDoc(doc(ctx.firestore(), 'conversations/deleted-parent'));
    });
    await assertFails(read('deleted-parent'));
    await assertFails(upload('deleted-parent'));
  });
});
