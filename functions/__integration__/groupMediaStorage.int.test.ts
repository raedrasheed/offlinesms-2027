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

// The pinned firebase-tools 13.35.1 emulator drops Content-Type on raw media
// uploads and substitutes application/octet-stream. Send explicit multipart
// metadata to exercise the real reservation/MIME rules without that emulator
// defect. This is authenticated REST coverage, not an exact native-wire test.
// https://github.com/firebase/firebase-tools/blob/v13.35.1/src/emulator/storage/apis/firebase.ts
// Neither upload nor download uses Admin Storage or a download token.
function upload(uid: string, path: string, sample: typeof samples[number]) {
  const boundary = 'offlinesms-group-media-test';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${JSON.stringify({
      name: path, contentType: sample.mimeType,
    })}\r\n--${boundary}\r\nContent-Type: ${sample.mimeType}\r\n\r\n`),
    sample.bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return fetch(`${origin}/v0/b/${bucket}/o?name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      Authorization: authorization(uid),
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'X-Goog-Upload-Protocol': 'multipart',
    },
    body,
  });
}
function read(uid: string | null, path: string) {
  return fetch(`${origin}/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`, {
    headers: uid ? { Authorization: authorization(uid) } : {},
  });
}

describe('group media through authenticated REST and real membership handlers', () => {
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
    const group = await db().doc(`conversations/${conversationId}`).get();
    expect(group.get('mediaAclVersion')).toBe(2);
    expect(group.get('participantUids')).toContain('peer');
    const reservation = await reserve('peer');
    expect((await db().doc(`conversations/${conversationId}/messages/${reservation.messageId}`).get()).data())
      .toMatchObject({ senderUid: 'peer', type: sample.type, media: {
        storagePath: reservation.storagePath, mimeType: sample.mimeType,
        sizeBytes: sample.bytes.length, uploadStatus: 'pending',
      } });
    expect((await upload('owner', reservation.storagePath, sample)).status).toBe(403);
    const uploaded = await upload('peer', reservation.storagePath, sample);
    const responseText = await uploaded.text();
    expect(uploaded.status, responseText).toBe(200);
    const metadata = JSON.parse(responseText);
    expect(metadata).toMatchObject({ name: reservation.storagePath, contentType: sample.mimeType });
    expect(Number(metadata.size)).toBe(sample.bytes.length);
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
