import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createMockUserToken } from '@firebase/util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { db, PROJECT, req, resetEmulators } from './harness';
import { createGroup } from '../src/chats/createGroup';
import { respondToGroupInvitation } from '../src/chats/memberInvitations';
import { createMediaMessage } from '../src/chats/createMediaMessage';
import { finalizeMediaMessage } from '../src/chats/finalizeMediaMessage';
import { removeMember } from '../src/chats/removeMember';
import { leaveGroup } from '../src/chats/leaveGroup';

const host = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
if (!host) throw new Error('group media integration tests require the Storage emulator');
const origin = `http://${host}`;
const bucket = `${PROJECT}.appspot.com`;
const authorization = (uid: string) => `Firebase ${createMockUserToken({ sub: uid }, PROJECT)}`;
let env: RulesTestEnvironment;

const samples = [
  { label: 'JPEG', type: 'image', mimeType: 'image/jpeg', fileName: 'photo.jpg', bytes: Buffer.from([255, 216, 255, 224]) },
  { label: 'PNG', type: 'image', mimeType: 'image/png', fileName: 'photo.png', bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
  { label: 'MP4', type: 'video', mimeType: 'video/mp4', fileName: 'video.mp4', bytes: Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0]) },
] as const;

// Match the native chat uploader's raw-body Firebase Storage REST request.
// Neither upload nor download uses Admin Storage or a download token: every
// request must pass the production Storage rules.
function upload(uid: string, path: string, sample: typeof samples[number]) {
  return fetch(`${origin}/v0/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: { Authorization: authorization(uid), 'Content-Type': sample.mimeType },
    body: sample.bytes,
  });
}
function read(uid: string | null, path: string) {
  return fetch(`${origin}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`, {
    headers: uid ? { Authorization: authorization(uid) } : {},
  });
}

describe('group media through native Storage requests and real membership handlers', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId: PROJECT,
      storage: { host: host!.split(':')[0], port: Number(host!.split(':')[1]), rules: readFileSync(resolve('storage.rules'), 'utf8') },
    });
  });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => {
    await resetEmulators();
    await env.clearStorage();
    for (const uid of ['owner', 'peer', 'removable', 'pending', 'outsider']) {
      await db().doc(`users/${uid}`).set({ displayName: uid, username: uid, usernameLower: uid, status: 'active' });
    }
  });

  it.each(samples)('uploads, finalizes and reads $label, then revokes removed and departed members', async sample => {
    const { conversationId } = await createGroup.run(req('owner', {
      name: 'Media lifecycle', memberUids: ['peer', 'removable', 'pending'],
    }));
    const reserve = (uid: string) => createMediaMessage.run(req(uid, {
      conversationId, type: sample.type, mimeType: sample.mimeType,
      fileName: sample.fileName, sizeBytes: sample.bytes.length,
    }));
    await expect(reserve('peer')).rejects.toMatchObject({ code: 'permission-denied' });
    for (const uid of ['peer', 'removable']) {
      await respondToGroupInvitation.run(req(uid, { conversationId, accept: true }));
    }
    const reservation = await reserve('peer');
    expect((await upload('owner', reservation.storagePath, sample)).status).toBe(403);
    const uploaded = await upload('peer', reservation.storagePath, sample);
    expect(uploaded.status, await uploaded.text()).toBe(200);
    expect((await read('owner', reservation.storagePath)).status).toBe(403);

    const finalized = await finalizeMediaMessage.run(req('peer', { conversationId, messageId: reservation.messageId }));
    expect(finalized.downloadURL).toContain(encodeURIComponent(reservation.storagePath));
    for (const uid of ['owner', 'peer', 'removable']) {
      const response = await read(uid, reservation.storagePath);
      expect(response.status).toBe(200);
      expect(Buffer.from(await response.arrayBuffer())).toEqual(sample.bytes);
    }
    for (const uid of ['pending', 'outsider', null]) {
      expect((await read(uid, reservation.storagePath)).status).toBe(403);
    }

    const removedPending = await reserve('removable');
    const departedPending = await reserve('peer');
    await removeMember.run(req('owner', { conversationId, memberUid: 'removable' }));
    await leaveGroup.run(req('peer', { conversationId }));
    for (const [uid, pending] of [['removable', removedPending], ['peer', departedPending]] as const) {
      expect((await read(uid, reservation.storagePath)).status).toBe(403);
      expect((await upload(uid, pending.storagePath, sample)).status).toBe(403);
      await expect(reserve(uid)).rejects.toMatchObject({ code: 'permission-denied' });
    }
    expect((await read('owner', reservation.storagePath)).status).toBe(200);

    // A deleted parent must revoke access even if its member/message subdocs
    // remain. This rules out replacing the live conversation check with a
    // member-only check.
    await db().doc(`conversations/${conversationId}`).delete();
    expect((await read('owner', reservation.storagePath)).status).toBe(403);
  });
});
