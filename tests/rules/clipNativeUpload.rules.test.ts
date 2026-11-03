import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { createMockUserToken } from '@firebase/util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deleteDoc, doc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const hasStorage = !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
const projectId = 'demo-offlinesms';
const bucket = projectId;
const owner = 'native-upload-owner';
const clip = 'native-upload-clip';
const sourcePath = `clipUploads/${owner}/${clip}/source`;
const origin = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199'}`;
const objectUrl = `${origin}/v0/b/${bucket}/o/${encodeURIComponent(sourcePath)}`;
const authorization = (uid: string) => `Firebase ${createMockUserToken({ sub: uid }, projectId)}`;
let env: RulesTestEnvironment;

/** Drive the same wire protocol as the native uploader, without mocking the
 * Storage endpoint or bypassing rules. The emulator authorizes at finalize,
 * so a successful session-start response alone must never count as an upload. */
async function start(uid: string, length: number, metadata: Record<string, unknown> = {}) {
  const response = await fetch(`${origin}/v0/b/${bucket}/o?name=${encodeURIComponent(sourcePath)}`, {
    method: 'POST',
    headers: {
      Authorization: authorization(uid), 'Content-Type': 'application/json; charset=utf-8',
      'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(length), 'X-Goog-Upload-Header-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({ name: sourcePath, contentType: 'video/mp4', ...metadata }),
  });
  expect(response.status).toBe(200);
  const sessionUrl = response.headers.get('x-goog-upload-url');
  expect(sessionUrl).toBeTruthy();
  return sessionUrl!;
}

function send(sessionUrl: string, uid: string, bytes: Uint8Array, offset: number, final: boolean) {
  return fetch(sessionUrl, {
    method: 'POST',
    headers: {
      Authorization: authorization(uid), 'Content-Type': 'application/octet-stream',
      'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload', 'X-Goog-Upload-Offset': String(offset),
    },
    body: Buffer.from(bytes),
  });
}

describe.skipIf(!hasStorage)('native clip resumable upload protocol with production rules', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({
      projectId,
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
      storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(resolve('storage.rules'), 'utf8') },
    });
  });
  afterAll(async () => { await env?.cleanup(); });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.clearStorage();
    await env.withSecurityRulesDisabled(async context => {
      await deleteObject(ref(context.storage(), sourcePath)).catch(error => {
        if (error.code !== 'storage/object-not-found') throw error;
      });
      const db = context.firestore();
      await setDoc(doc(db, `clipProfiles/${owner}`), { suspended: false, deleting: false });
      await setDoc(doc(db, `clips/${clip}`), {
        ownerUid: owner, status: 'uploading', sourcePath, maxUploadBytes: 600_000,
        uploadExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      });
    });
  });

  it('uploads bounded chunks, recovers the acknowledged offset, and keeps source reads private', async () => {
    const bytes = Uint8Array.from({ length: 300_017 }, (_, index) => index % 251);
    const firstChunk = 256 * 1024;
    const sessionUrl = await start(owner, bytes.length);
    const partial = await send(sessionUrl, owner, bytes.subarray(0, firstChunk), 0, false);
    expect(partial.status).toBe(200);
    expect(partial.headers.get('x-goog-upload-status')).toBe('active');
    const query = await fetch(sessionUrl, {
      method: 'POST', headers: { Authorization: authorization(owner), 'X-Goog-Upload-Command': 'query' },
    });
    expect(query.status).toBe(200);
    expect(query.headers.get('x-goog-upload-status')).toBe('active');
    expect(Number(query.headers.get('x-goog-upload-size-received'))).toBe(firstChunk);
    const completed = await send(sessionUrl, owner, bytes.subarray(firstChunk), firstChunk, true);
    expect(completed.status).toBe(200);
    expect(completed.headers.get('x-goog-upload-status')).toBe('final');
    const metadata = await completed.json();
    expect(metadata).toMatchObject({ name: sourcePath, contentType: 'video/mp4' });
    expect(Number(metadata.size)).toBe(bytes.length);
    await env.withSecurityRulesDisabled(async context => {
      const stored = new Uint8Array(await getBytes(ref(context.storage(bucket), sourcePath)));
      expect(stored).toEqual(bytes);
    });
    for (const uid of [owner, 'native-upload-peer']) {
      const denied = await fetch(`${objectUrl}?alt=media`, { headers: { Authorization: authorization(uid) } });
      expect(denied.status).toBe(403);
    }
    expect((await fetch(`${objectUrl}?alt=media`)).status).toBe(403);
  });

  it('rejects another account at finalization and creates no object', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sessionUrl = await start('native-upload-peer', bytes.length);
    const completed = await send(sessionUrl, 'native-upload-peer', bytes, 0, true);
    expect(completed.status).toBe(403);
    await env.withSecurityRulesDisabled(async context => {
      await expect(getBytes(ref(context.storage(bucket), sourcePath))).rejects.toMatchObject({ code: 'storage/object-not-found' });
    });
  });

  it.each([
    ['omitted', {}],
    ['empty map', { metadata: {} }],
    ['null', { metadata: null }],
  ] as const)('accepts native upload metadata represented as %s', async (_label, metadata) => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sessionUrl = await start(owner, bytes.length, metadata);
    const completed = await send(sessionUrl, owner, bytes, 0, true);
    expect(completed.status).toBe(200);
    expect(completed.headers.get('x-goog-upload-status')).toBe('final');
    await env.withSecurityRulesDisabled(async context => {
      expect(new Uint8Array(await getBytes(ref(context.storage(bucket), sourcePath)))).toEqual(bytes);
    });
    expect((await fetch(`${objectUrl}?alt=media`, { headers: { Authorization: authorization(owner) } })).status).toBe(403);
  });

  it('checks raw optional metadata shapes before Storage normalizes the wire request', async () => {
    // The Storage emulator normalizes absent/null metadata to {}. Feed raw
    // shapes to the production helper through test-only claims to cover the
    // missing/null branches independently of the emulator's wire normalization.
    const productionRules = readFileSync(resolve('storage.rules'), 'utf8');
    const call = 'hasNoCustomMetadata(request.resource)';
    expect(productionRules.split(call)).toHaveLength(2);
    const probeRules = productionRules.replace(call, 'hasNoCustomMetadata(request.auth.token.clipProbeResource)');
    const storageOptions = { host: '127.0.0.1', port: 9199 };
    const probe = await initializeTestEnvironment({ projectId, storage: { ...storageOptions, rules: probeRules } });
    const uploadProbe = (shape: Record<string, unknown>, uid = owner) => uploadBytes(
      ref(probe.authenticatedContext(uid, { clipProbeResource: shape }).storage(bucket), sourcePath),
      new Uint8Array([1, 2, 3]), { contentType: 'video/mp4' },
    );
    try {
      for (const shape of [{}, { metadata: null }, { metadata: {} }]) await assertSucceeds(uploadProbe(shape));
      for (const metadata of [{ access: 'public' }, { firebaseStorageDownloadTokens: 'forged' },
        [], ['public'], '', 'public', false, 0]) await assertFails(uploadProbe({ metadata }));
      for (const shape of [{}, { metadata: null }, { metadata: {} }]) await assertFails(uploadProbe(shape, 'native-upload-peer'));
    } finally {
      await probe.cleanup();
      const restored = await initializeTestEnvironment({ projectId, storage: { ...storageOptions, rules: productionRules } });
      await restored.cleanup();
    }
  });

  it('permits a reserved upload when an existing publisher profile omits optional flags', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `clipProfiles/${owner}`), { termsVersion: 'clips-v1' });
    });
    const bytes = new Uint8Array([1, 2, 3]);
    const sessionUrl = await start(owner, bytes.length);
    const completed = await send(sessionUrl, owner, bytes, 0, true);
    expect(completed.status).toBe(200);
    expect(completed.headers.get('x-goog-upload-status')).toBe('final');
    await env.withSecurityRulesDisabled(async context => {
      expect(new Uint8Array(await getBytes(ref(context.storage(bucket), sourcePath)))).toEqual(bytes);
    });
  });

  it('rejects finalization if the publisher profile disappears after the session starts', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sessionUrl = await start(owner, bytes.length);
    await env.withSecurityRulesDisabled(async context => {
      await deleteDoc(doc(context.firestore(), `clipProfiles/${owner}`));
    });
    expect((await send(sessionUrl, owner, bytes, 0, true)).status).toBe(403);
    await env.withSecurityRulesDisabled(async context => {
      await expect(getBytes(ref(context.storage(bucket), sourcePath))).rejects.toMatchObject({ code: 'storage/object-not-found' });
    });
  });

  it('enforces actual byte size and rejects custom metadata in the native REST path', async () => {
    await env.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), `clips/${clip}`), { maxUploadBytes: 20 });
    });
    // An understated start header cannot authorize an oversized finalized file.
    const oversized = await start(owner, 3);
    expect((await send(oversized, owner, new Uint8Array(21), 0, true)).status).toBe(403);
    const injectedMetadata = await start(owner, 3, { metadata: { access: 'public' } });
    expect((await send(injectedMetadata, owner, new Uint8Array([1, 2, 3]), 0, true)).status).toBe(403);
  });

  it('checks the current reservation at finalization after processing has begun', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const sessionUrl = await start(owner, bytes.length);
    await env.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), `clips/${clip}`), { status: 'processing' });
    });
    expect((await send(sessionUrl, owner, bytes, 0, true)).status).toBe(403);
  });
});
