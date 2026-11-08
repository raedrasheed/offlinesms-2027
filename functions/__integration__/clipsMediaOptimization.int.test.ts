import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getStorage } from 'firebase-admin/storage';
import { db, req, resetEmulators, Timestamp } from './harness';
import { getClipPlayback } from '../src/clips/media';
import { clipFfmpegPath, clipMediaBinaryEnv } from '../src/clips/mediaBinary';
import { CLIP_ENCODING_VERSION } from '../src/clips/mediaTools';
import * as tools from '../src/clips/mediaTools';
import { optimizeClipMedia, optimizeExistingClipMedia } from '../src/clips/mediaOptimization';

let directory: string, large: Buffer, small: Buffer;
const prefix = 'clipMedia/owner/legacy/';
const paths = [prefix + 'standard.mp4', prefix + 'dataSaver.mp4', prefix + 'cover.jpg'];
const publishedAt = Timestamp.fromMillis(1_700_000_000_000);
beforeAll(async () => {
  if (!process.env.FIREBASE_STORAGE_EMULATOR_HOST) throw new Error('Storage emulator required');
  directory = await mkdtemp(join(tmpdir(), 'clip-optimization-test-'));
  for (const [name, preset, crf] of [['large', 'ultrafast', '18'], ['small', 'veryfast', '40']]) {
    const path = join(directory, name + '.mp4');
    await promisify(execFile)(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=180x320:rate=24', '-t', '1', '-c:v', 'libx264', '-threads', '1', '-preset', preset, '-crf', crf,
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path], { env: clipMediaBinaryEnv });
  }
  large = await readFile(join(directory, 'large.mp4')); small = await readFile(join(directory, 'small.mp4'));
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(async () => {
  await resetEmulators();
  await getStorage().bucket().deleteFiles({ prefix: 'clipMedia/', force: true });
  await db().doc('systemSettings/clips').set({ enabled: true });
  await db().doc('users/owner').set({ status: 'active' });
  await db().doc('users/viewer').set({ status: 'active' });
  for (let index = 0; index < paths.length; index++) await getStorage().bucket().file(paths[index]).save(
    index < 2 ? large : Buffer.from([255, 216, 255]), { metadata: { contentType: index < 2 ? 'video/mp4' : 'image/jpeg' } });
  await db().doc('clips/legacy').set({ ownerUid: 'owner', status: 'published', audience: 'public', renderVersion: 1,
    standardPath: paths[0], dataSaverPath: paths[1], coverPath: paths[2],
    sourceSizeBytes: 0, processedBytes: large.length * 2 + 3, totalStorageBytes: large.length * 2 + 3,
    createdAt: publishedAt, publishedAt });
});

function mockRender(bytes = small, duringRender?: () => Promise<void>) {
  return vi.spyOn(tools, 'renderClipVideo').mockImplementation(async (_source, target) => {
    const standard = join(target, 'standard.mp4'), dataSaver = join(target, 'dataSaver.mp4');
    await writeFile(standard, bytes); await writeFile(dataSaver, bytes);
    if (duringRender) await duringRender();
    return { standard, dataSaver, cover: join(target, 'unused-cover.jpg'), durationMs: 1000, width: 180, height: 320 };
  });
}

describe('Existing clip compression', () => {
  it('publishes smaller complete MP4s, preserves existing streams and signs the optimized path', async () => {
    mockRender();
    const original = await Promise.all(paths.map(async path => (await getStorage().bucket().file(path).getMetadata())[0]));
    expect(await optimizeClipMedia('legacy')).toBe(true);
    const row = await db().doc('clips/legacy').get();
    expect(row.data()).toMatchObject({ status: 'published', encodingVersion: CLIP_ENCODING_VERSION,
      processedBytes: large.length * 2 + small.length * 2 + 3, totalStorageBytes: large.length * 2 + small.length * 2 + 3,
      sourceSizeBytes: 0, standardPath: paths[0], dataSaverPath: paths[1], coverPath: paths[2],
      optimizationLeaseToken: null, optimizationError: null });
    expect(row.get('publishedAt').isEqual(publishedAt)).toBe(true);
    expect(row.get('createdAt').isEqual(publishedAt)).toBe(true);
    for (const quality of ['standard', 'dataSaver']) {
      const path = row.get(`optimizedPlayback.${quality}`);
      expect((await getStorage().bucket().file(path).download())[0]).toEqual(small);
    }
    for (let index = 0; index < 2; index++) expect((await getStorage().bucket().file(paths[index]).download())[0]).toEqual(large);
    expect((await getStorage().bucket().file(paths[2]).getMetadata())[0].generation).toBe(original[2].generation);
    vi.spyOn(Object.getPrototypeOf(getStorage().bucket().file('placeholder')), 'getSignedUrl')
      .mockImplementation(async function (this: { name: string }) { return [`https://signed.invalid/${this.name}`]; });
    expect((await getClipPlayback.run(req('viewer', { clipId: 'legacy' }))).url).toContain(row.get('optimizedPlayback.standard'));
    await db().doc('clips/legacy').update({ 'optimizedPlayback.standard': 'clipMedia/other/private.mp4' });
    await expect(getClipPlayback.run(req('viewer', { clipId: 'legacy' }))).rejects.toThrow('clip-media-path-invalid');
    expect(await optimizeClipMedia('legacy')).toBe(false);
  });
  it('keeps an existing smaller rendition and can process the real encoder output', async () => {
    await getStorage().bucket().file(paths[1]).save(small, { metadata: { contentType: 'video/mp4' } });
    const [before] = await getStorage().bucket().file(paths[1]).getMetadata();
    expect(await optimizeClipMedia('legacy')).toBe(true);
    const [after] = await getStorage().bucket().file(paths[1]).getMetadata();
    expect(after.generation).toBe(before.generation);
    const optimized = await db().doc('clips/legacy').get();
    expect(optimized.get('optimizedPlayback.dataSaver')).toBeNull();
    expect(Number((await getStorage().bucket().file(optimized.get('optimizedPlayback.standard')).getMetadata())[0].size)).toBeLessThan(large.length);
  });
  it('does not upload or resurrect media when a clip is removed during rendering', async () => {
    mockRender(small, async () => {
      await db().doc('clips/legacy').update({ status: 'removed' });
      await getStorage().bucket().deleteFiles({ prefix, force: true });
    });
    expect(await optimizeClipMedia('legacy')).toBe(false);
    expect((await getStorage().bucket().getFiles({ prefix }))[0]).toHaveLength(0);
    expect((await db().doc('clips/legacy').get()).get('status')).toBe('removed');
  });
  it('fences duplicate workers and a changed edit revision', async () => {
    mockRender(small, async () => { await db().doc('clips/legacy').update({ renderVersion: 2 }); });
    expect(await optimizeClipMedia('legacy')).toBe(false);
    expect((await getStorage().bucket().file(paths[0]).download())[0]).toEqual(large);
    await db().doc('clips/legacy').update({ optimizationLeaseUntil: Timestamp.fromMillis(Date.now() + 60_000) });
    expect(await optimizeClipMedia('legacy')).toBe(false);
  });
  it('cleans a partial upload before retrying and keeps original playback available', async () => {
    mockRender();
    const prototype = Object.getPrototypeOf(getStorage().bucket()), upload = prototype.upload;
    const options: any[] = [];
    const fail = vi.spyOn(prototype, 'upload').mockImplementation(async function (this: any, ...args: unknown[]) {
      const [path, opts] = args as [string, any];
      options.push(opts);
      if (opts.destination.endsWith('/dataSaver.mp4')) throw Object.assign(new Error('temporary'), { code: 503 });
      return upload.call(this, path, opts);
    });
    await expect(optimizeClipMedia('legacy')).rejects.toThrow('temporary');
    expect(options[0].preconditionOpts).toEqual({ ifGenerationMatch: 0 });
    const partial = await db().doc('clips/legacy').get();
    expect(partial.get('encodingVersion')).toBeUndefined();
    expect(partial.get('optimizationLeaseToken')).toBeNull();
    expect(partial.get('processedBytes')).toBe(large.length * 2 + 3);
    expect((await getStorage().bucket().getFiles({ prefix }))[0]).toHaveLength(3);
    fail.mockRestore();
    expect(await optimizeClipMedia('legacy')).toBe(true);
    expect((await db().doc('clips/legacy').get()).get('processedBytes')).toBe(large.length * 2 + small.length * 2 + 3);
  });
  it('retains published renditions when a durable commit response is lost', async () => {
    mockRender();
    const prototype = Object.getPrototypeOf(db()), transaction = prototype.runTransaction;
    let lost = false;
    vi.spyOn(prototype, 'runTransaction').mockImplementation(async function (this: any, ...args: unknown[]) {
      const result = await transaction.apply(this, args);
      if (result === true && !lost) { lost = true; throw new Error('lost-commit-response'); }
      return result;
    });
    await expect(optimizeClipMedia('legacy')).rejects.toThrow('lost-commit-response');
    const row = await db().doc('clips/legacy').get();
    expect(row.get('encodingVersion')).toBe(CLIP_ENCODING_VERSION);
    expect((await getStorage().bucket().file(row.get('optimizedPlayback.standard')).download())[0]).toEqual(small);
    expect((await getStorage().bucket().file(row.get('optimizedPlayback.dataSaver')).download())[0]).toEqual(small);
  });
  it('walks legacy documents without encodingVersion and resets the scan at its end', async () => {
    mockRender();
    await db().doc('clips/aaa-new').set({ ownerUid: 'owner', status: 'published', encodingVersion: CLIP_ENCODING_VERSION });
    await db().doc('clips/zzz-removed').set({ ownerUid: 'owner', status: 'removed' });
    await optimizeExistingClipMedia.run({} as never);
    expect((await db().doc('clips/legacy').get()).get('encodingVersion')).toBe(CLIP_ENCODING_VERSION);
    expect((await db().doc('systemState/clipMediaOptimization').get()).get('lastId')).toBe('legacy');
    await optimizeExistingClipMedia.run({} as never);
    expect((await db().doc('systemState/clipMediaOptimization').get()).get('lastId')).toBeNull();
  });
});
