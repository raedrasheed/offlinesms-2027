import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStorage } from 'firebase-admin/storage';
import { db, req, resetEmulators, Timestamp, expectHttps } from './harness';
import { initClipUpload, publishClip } from '../src/clips/media';
import { processClipMedia, purgeClipFiles } from '../src/clips/mediaProcessing';
import * as mediaTools from '../src/clips/mediaTools';

const edits = { trimStartMs: 0, trimEndMs: 1000, coverTimeMs: 500, overlayText: '', mute: true };
const metadata = { caption: 'recovery test', audience: 'public', allowComments: true, allowDownload: false };
beforeEach(async () => {
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Recovery tests require Storage emulator');
  await resetEmulators();
  await getStorage().bucket().deleteFiles({ prefix: 'clipUploads/', force: true });
  await getStorage().bucket().deleteFiles({ prefix: 'clipMedia/', force: true });
  await db().doc('systemSettings/clips').set({ enabled: true, moderationRequired: true, termsVersion: 'clips-v1' });
  await db().doc('users/owner').set({ status: 'active', displayName: 'Owner' });
  await db().doc('clipProfiles/owner').set({ termsVersion: 'clips-v1' });
});
afterEach(() => vi.restoreAllMocks());
async function reserveAndUpload(draftId: string) {
  const result = await initClipUpload.run(req('owner', { draftId }));
  await getStorage().bucket().file(result.storagePath).save(Buffer.from('metadata-valid fixture'), { metadata: { contentType: 'video/mp4' } });
  return result;
}

describe('Clips media recovery boundaries', () => {
  it('renews the idle timestamp with an expired draft lease so cleanup cannot erase a resumed upload', async () => {
    const initial = await initClipUpload.run(req('owner', { draftId: 'resume' }));
    const old = Timestamp.fromMillis(Date.now() - 48 * 60 * 60_000);
    await db().doc(`clips/${initial.clipId}`).update({ uploadExpiresAt: old, updatedAt: old });
    const start = Date.now();
    const retry = await initClipUpload.run(req('owner', { draftId: 'resume' }));
    expect(retry.clipId).toBe(initial.clipId);
    const clip = await db().doc(`clips/${initial.clipId}`).get();
    expect(clip.get('uploadExpiresAt').toMillis()).toBeGreaterThan(start);
    expect(clip.get('updatedAt').toMillis()).toBeGreaterThanOrEqual(start);
  });

  it('caps direct publication attempts independently of draft reservations', async () => {
    const initial = await reserveAndUpload('rate');
    await db().doc('clipProfiles/owner/rateLimits/publish').set({ count: 12, windowStartMs: Date.now() });
    await expectHttps(publishClip.run(req('owner', { clipId: initial.clipId, ...edits, ...metadata })), 'resource-exhausted');
    expect((await db().doc(`clips/${initial.clipId}`).get()).get('status')).toBe('uploading');
  });

  it('purges a late object when deletion wins after the upload fence and a subsequent upload fails', async () => {
    const initial = await reserveAndUpload('late-object');
    await publishClip.run(req('owner', { clipId: initial.clipId, ...edits, ...metadata }));
    // The decoder itself has its own real-FFmpeg suite. This test controls only
    // the external storage ordering after the decoder has produced its files.
    vi.spyOn(mediaTools, 'renderClipVideo').mockImplementation(async (_source, directory) => {
      const standard = join(directory, 'standard.mp4'), dataSaver = join(directory, 'dataSaver.mp4'), cover = join(directory, 'cover.jpg');
      await Promise.all([standard, dataSaver, cover].map(path => writeFile(path, Buffer.from('rendered output'))));
      return { standard, dataSaver, cover, durationMs: 1000, width: 180, height: 320 };
    });
    const bucket = getStorage().bucket(), prototype = Object.getPrototypeOf(bucket), upload = prototype.upload;
    let uploads = 0;
    vi.spyOn(prototype, 'upload').mockImplementation(async function (this: typeof bucket, ...args: unknown[]) {
      uploads++;
      if (uploads === 1) {
        await db().doc(`clips/${initial.clipId}`).update({ status: 'removed', updatedAt: Timestamp.now() });
        await purgeClipFiles(initial.clipId, 'owner');
        await db().doc(`clips/${initial.clipId}`).update({ mediaPurgedAt: Timestamp.now() });
        // This write occurs AFTER the removal trigger has already completed.
        return upload.apply(this, args);
      }
      throw new Error('simulated-storage-transport-failure');
    });
    await processClipMedia(initial.clipId).catch(() => {});
    expect(uploads).toBe(2);
    expect((await db().doc(`clips/${initial.clipId}`).get()).get('status')).toBe('removed');
    expect((await bucket.getFiles({ prefix: `clipMedia/owner/${initial.clipId}/` }))[0]).toHaveLength(0);
  });
});
