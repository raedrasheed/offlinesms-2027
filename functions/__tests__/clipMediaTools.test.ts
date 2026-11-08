import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clipFfmpegPath, clipFfprobePath, clipMediaBinaryEnv } from '../src/clips/mediaBinary';
import { probeClipVideo, renderClipVideo, validateClipEdits } from '../src/clips/mediaTools';

const exec = promisify(execFile);
let directory: string, source: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clips-media-test-')); source = join(directory, 'source.mp4');
  await exec(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=15',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-threads', '1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { timeout: 60_000, env: clipMediaBinaryEnv });
}, 65_000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe('actual clip bytes and processing', () => {
  it('probes actual video duration and rejects a forged MP4 or a network playlist', async () => {
    expect(await probeClipVideo(source)).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    const forged = join(directory, 'forged.mp4'); await writeFile(forged, '#EXTM3U\nhttps://example.invalid/private.mp4');
    await expect(probeClipVideo(forged)).rejects.toThrow();
    await mkdir(join(directory, 'outside'));
    await expect(renderClipVideo(source, join(directory, 'outside'), {
      trimStartMs: 0, trimEndMs: 60_000, coverTimeMs: 0, overlayText: '', mute: false,
    })).rejects.toThrow('clip-trim-outside-source');
  });
  it('renders a trimmed, muted Arabic overlay, bounded standard/low MP4s and the selected JPEG cover', async () => {
    const target = join(directory, 'muted'); await mkdir(target);
    const out = await renderClipVideo(source, target, { trimStartMs: 500, trimEndMs: 1500, coverTimeMs: 1200,
      overlayText: "رحلة جميلة %{literal} : ' نص", mute: true });
    expect(out).toMatchObject({ width: 720, height: 1280 });
    expect(out.durationMs).toBeGreaterThanOrEqual(950); expect(out.durationMs).toBeLessThanOrEqual(1100);
    expect(await probeClipVideo(out.standard)).toMatchObject({ hasAudio: false });
    expect(await probeClipVideo(out.dataSaver)).toMatchObject({ width: 360, height: 640, hasAudio: false });
    expect((await readFile(out.cover)).subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
  }, 60_000);
  it('retains audio when mute is off', async () => {
    const target = join(directory, 'audio'); await mkdir(target);
    const out = await renderClipVideo(source, target, { trimStartMs: 0, trimEndMs: 1000, coverTimeMs: 0, overlayText: '', mute: false });
    expect(await probeClipVideo(out.standard)).toMatchObject({ hasAudio: true });
    expect(await probeClipVideo(out.dataSaver)).toMatchObject({ hasAudio: true });
  }, 60_000);
  it('bounds selected duration and requires cover inside the original trim interval', () => {
    const edits = { trimStartMs: 1000, trimEndMs: 61_000, coverTimeMs: 1000, overlayText: '', mute: false };
    expect(validateClipEdits(edits, 60)).toEqual(edits);
    for (const change of [{ trimEndMs: 61_001 }, { coverTimeMs: 999 }, { coverTimeMs: 61_000 }, { trimStartMs: NaN },
      { overlayText: 'a'.repeat(101) }, { mute: 'yes' }])
      expect(() => validateClipEdits({ ...edits, ...change }, 60)).toThrow();
  });
  it('bounds busy-video bandwidth and writes decodable fast-start MP4s', async () => {
    const busy = join(directory, 'busy.mp4'), target = join(directory, 'bounded');
    await mkdir(target);
    await exec(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=720x1280:rate=30,noise=alls=25:allf=t+u:all_seed=7',
      '-t', '8', '-c:v', 'libx264', '-crf', '18', '-preset', 'ultrafast', '-threads', '1', busy],
    { timeout: 60_000, env: clipMediaBinaryEnv });
    const out = await renderClipVideo(busy, target, {
      trimStartMs: 0, trimEndMs: 8000, coverTimeMs: 0, overlayText: '', mute: false,
    });
    for (const [path, maximumRate] of [[out.standard, 1_450_000], [out.dataSaver, 620_000]] as const) {
      const bytes = await readFile(path);
      const { stdout } = await exec(clipFfprobePath, ['-v', 'error', '-show_format', '-of', 'json', path], { env: clipMediaBinaryEnv });
      expect(Number(JSON.parse(stdout).format.bit_rate)).toBeLessThan(maximumRate);
      expect(bytes.indexOf(Buffer.from('moov'))).toBeGreaterThan(0);
      expect(bytes.indexOf(Buffer.from('moov'))).toBeLessThan(bytes.indexOf(Buffer.from('mdat')));
      await exec(clipFfmpegPath, ['-v', 'error', '-i', path, '-f', 'null', '-'], { timeout: 30_000, env: clipMediaBinaryEnv });
    }
    expect((await readFile(out.standard)).length).toBeLessThan((await readFile(busy)).length / 2);
  }, 120_000);
});

