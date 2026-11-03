import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clipFfmpegPath, clipMediaBinaryEnv } from '../src/clips/mediaBinary';
import { getStorage } from 'firebase-admin/storage';
import { db, req, resetEmulators } from './harness';
import { getClipPlayback, getClipThumbnails, initClipUpload, publishClip, CLIP_URL_TTL_MS } from '../src/clips/media';
import { processClipMedia, purgeClipFiles, stripClipSourceToken } from '../src/clips/mediaProcessing';
import * as mediaTools from '../src/clips/mediaTools';

const sourceEdits = { trimStartMs: 0, trimEndMs: 1000, coverTimeMs: 500, overlayText: 'مرحبا', mute: false };
const clipMeta = { caption: '#تجربة', audience: 'public', allowComments: true, allowDownload: false };
let directory: string, fixture: Buffer;
beforeAll(async () => {
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Clip media tests require Storage emulator');
  directory = await mkdtemp(join(tmpdir(), 'clips-emulator-test-'));
  const path = join(directory, 'fixture.mp4');
  await promisify(execFile)(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=180x320:rate=15', '-t', '1.2', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', path], { env: clipMediaBinaryEnv });
  fixture = await readFile(path);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await resetEmulators();
  await getStorage().bucket().deleteFiles({ prefix: 'clipUploads/', force: true });
  await getStorage().bucket().deleteFiles({ prefix: 'clipMedia/', force: true });
  await db().doc('systemSettings/clips').set({ enabled: true, moderationRequired: true, maxDailyUploads: 2, termsVersion: 'clips-v1' });
  for (const uid of ['owner', 'viewer']) {
    await db().doc(`users/${uid}`).set({ status: 'active', displayName: uid });
    await db().doc(`clipProfiles/${uid}`).set({ termsVersion: 'clips-v1' });
  }
});
async function upload(draftId = 'draft-one', bytes = fixture) {
  const result = await initClipUpload.run(req('owner', { draftId }));
  await getStorage().bucket().file(result.storagePath).save(bytes, {
    metadata: { contentType: 'video/mp4', metadata: { firebaseStorageDownloadTokens: 'original-secret-token' } },
  });
  return result;
}
async function submit(id: string, data: Record<string, unknown> = {}) {
  return publishClip.run(req('owner', { clipId: id, ...sourceEdits, ...clipMeta, ...data }));
}

describe('Clip media lifecycle with real emulator storage and FFmpeg', () => {
  it('requires current terms and enabled feature, reserves idempotently and limits daily uploads atomically', async () => {
    await db().doc('systemSettings/clips').update({ enabled: false });
    await expect(initClipUpload.run(req('owner', { draftId: 'one' }))).rejects.toThrow('clips-disabled');
    await db().doc('systemSettings/clips').update({ enabled: true, termsVersion: 'clips-v2' });
    await expect(initClipUpload.run(req('owner', { draftId: 'one' }))).rejects.toThrow('clips-terms-required');
    await db().doc('clipProfiles/owner').update({ termsVersion: 'clips-v2' });
    const first = await initClipUpload.run(req('owner', { draftId: 'one' }));
    expect(await initClipUpload.run(req('owner', { draftId: 'one' }))).toMatchObject({ clipId: first.clipId });
    const results = await Promise.allSettled(['two', 'three'].map(draftId => initClipUpload.run(req('owner', { draftId }))));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('processes once into token-free variants and moderation queue, then purges source bytes', async () => {
    const reserved = await upload();
    await expect(publishClip.run(req('viewer', { clipId: reserved.clipId, ...sourceEdits, ...clipMeta }))).rejects.toThrow('clip-unavailable');
    await submit(reserved.clipId); await processClipMedia(reserved.clipId); await processClipMedia(reserved.clipId);
    const clip = (await db().doc(`clips/${reserved.clipId}`).get()).data()!;
    expect(clip).toMatchObject({ status: 'pending_review', processingAttempts: 1, sourceSizeBytes: 0, width: 180, height: 320 });
    expect(clip.totalStorageBytes).toBe(clip.processedBytes);
    expect(clip.processedBytes).toBeGreaterThan(0);
    for (const path of [clip.standardPath, clip.dataSaverPath, clip.coverPath]) {
      const [meta] = await getStorage().bucket().file(path).getMetadata();
      expect(meta.metadata?.firebaseStorageDownloadTokens).toBeFalsy();
    }
    expect((await getStorage().bucket().file(reserved.storagePath).exists())[0]).toBe(false);
    await purgeClipFiles(reserved.clipId, 'owner');
    expect((await getStorage().bucket().file(clip.standardPath).exists())[0]).toBe(false);
  });
  it('cannot publish forged duration or non-video bytes', async () => {
    const a = await upload(); await submit(a.clipId, { trimEndMs: 60_000 }); await processClipMedia(a.clipId);
    expect((await db().doc(`clips/${a.clipId}`).get()).get('status')).toBe('failed');
    const b = await upload('forged', Buffer.from('not a real video'));
    await submit(b.clipId);
    for (let i = 0; i < 3; i++) await processClipMedia(b.clipId).catch(() => {});
    const forged = await db().doc(`clips/${b.clipId}`).get();
    expect(forged.get('status')).toBe('failed'); expect(forged.get('standardPath')).toBeUndefined();
  });
  it.each(['disabled', 'suspended', 'groupRemoved'])('rechecks %s during rendering before publication', async change => {
    await db().doc('systemSettings/clips').update({ moderationRequired: false });
    await db().doc('conversations/group').set({ type: 'group', participantUids: ['owner', 'viewer'] });
    await db().doc('conversations/group/members/owner').set({ status: 'active' });
    const a = await upload(); await submit(a.clipId, { audience: 'group', groupId: 'group' });
    const render = mediaTools.renderClipVideo;
    vi.spyOn(mediaTools, 'renderClipVideo').mockImplementation(async (...args) => {
      const output = await render(...args);
      if (change === 'disabled') await db().doc('systemSettings/clips').update({ enabled: false });
      if (change === 'suspended') await db().doc('clipProfiles/owner').update({ suspended: true });
      if (change === 'groupRemoved') await db().doc('conversations/group/members/owner').delete();
      return output;
    });
    await processClipMedia(a.clipId);
    const clip = await db().doc(`clips/${a.clipId}`).get();
    expect(clip.get('status')).toBe('failed'); expect(clip.get('publishedAt')).toBeUndefined();
  });
  it('rechecks access for 120-second URLs, enforces download permission and skips inaccessible thumbnails', async () => {
    const a = await upload(); await submit(a.clipId); await processClipMedia(a.clipId);
    await db().doc(`clips/${a.clipId}`).update({ status: 'published' });
    const file = getStorage().bucket().file('placeholder');
    const sign = vi.spyOn(Object.getPrototypeOf(file), 'getSignedUrl').mockImplementation(async function (this: { name: string }, opts: any) {
      return [`https://signed.invalid/${this.name}?expires=${opts.expires}`];
    });
    const start = Date.now();
    const result = await getClipPlayback.run(req('viewer', { clipId: a.clipId, quality: 'dataSaver' }));
    expect(result.url).toContain('/dataSaver.mp4?'); expect(result.thumbnailUrl).toContain('/cover.jpg?');
    expect(result.expiresAtMs).toBeGreaterThanOrEqual(start + CLIP_URL_TTL_MS);
    expect(result.expiresAtMs).toBeLessThanOrEqual(Date.now() + CLIP_URL_TTL_MS);
    await expect(getClipPlayback.run(req('viewer', { clipId: a.clipId, download: true }))).rejects.toThrow('clip-download-disabled');
    await db().doc(`users/owner/blockedUsers/viewer`).set({ createdAt: new Date() });
    await expect(getClipPlayback.run(req('viewer', { clipId: a.clipId }))).rejects.toThrow('clip-unavailable');
    expect(await getClipThumbnails.run(req('viewer', { clipIds: [a.clipId, 'missing'] }))).toEqual({ items: [] });
    expect(sign).toHaveBeenCalledTimes(2);
    await db().doc(`clips/${a.clipId}`).update({ standardPath: 'private/someone-else.mp4' });
    await expect(getClipPlayback.run(req('owner', { clipId: a.clipId }))).rejects.toThrow('clip-media-path-invalid');
  });
  it('scrubs original-file tokens without touching other media paths', async () => {
    const a = await upload(); const file = getStorage().bucket().file(a.storagePath);
    const [meta] = await file.getMetadata();
    const clear = vi.spyOn(Object.getPrototypeOf(file), 'setMetadata');
    await stripClipSourceToken({ name: a.storagePath, bucket: file.bucket.name, generation: meta.generation, metadata: { firebaseStorageDownloadTokens: 'original-secret-token' } });
    expect(clear).toHaveBeenCalledWith({ metadata: { firebaseStorageDownloadTokens: null } });
    // firebase-tools 13's metadata.js only APPENDS tokens to an internal list;
    // it does not implement GCS custom-metadata null deletion. The production
    // API contract is asserted above; token revocation needs a deployed smoke
    // test. Physical cleanup is fully supported and verified in the emulator.
    expect(Number((await file.getMetadata())[0].metageneration)).toBeGreaterThan(Number(meta.metageneration));
    await expect(stripClipSourceToken({ name: 'chatImages/other/photo', bucket: file.bucket.name, metadata: { firebaseStorageDownloadTokens: 'keep' } })).resolves.toBeUndefined();
    expect(clear).toHaveBeenCalledOnce();
    await purgeClipFiles(a.clipId, 'owner'); expect((await file.exists())[0]).toBe(false);
  });
});
