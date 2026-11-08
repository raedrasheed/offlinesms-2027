import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clipFfmpegPath, clipFfprobePath, clipMediaBinaryEnv } from '../src/clips/mediaBinary';
import { renderChatVideoFirstFrame } from '../src/chats/videoThumbnailTools';
const exec = promisify(execFile);
let directory: string, source: string;
const run = (args: string[]) => exec(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-filter_threads', '1', ...args], { timeout: 45_000, env: clipMediaBinaryEnv });
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'chat-first-frame-test-')); source = join(directory, 'source.mp4');
  await run(['-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=10:d=0.3', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=10:d=0.7',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', source]);
}, 50_000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
describe('real first-frame chat thumbnails', () => {
  it('extracts the first red frame rather than a later blue frame, with bounded JPEG dimensions', async () => {
    const target = join(directory, 'mp4'); await mkdir(target);
    const output = await renderChatVideoFirstFrame(source, target), bytes = await readFile(output);
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255])); expect(bytes.length).toBeLessThan(512 * 1024);
    const { stdout } = await exec(clipFfprobePath, ['-v', 'error', '-show_streams', '-of', 'json', output], { env: clipMediaBinaryEnv });
    expect(JSON.parse(stdout).streams[0]).toMatchObject({ width: 480, height: 270 });
    const { stdout: pixel } = await exec(clipFfmpegPath, ['-v', 'error', '-i', output, '-vf', 'scale=1:1', '-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { encoding: 'buffer', env: clipMediaBinaryEnv });
    expect(pixel[0]).toBeGreaterThan(200); expect(pixel[1]).toBeLessThan(50); expect(pixel[2]).toBeLessThan(50);
  });
  it('also supports MOV and WebM source containers', async () => {
    for (const [extension, codec] of [['mov', 'copy'], ['webm', 'libvpx-vp9']]) {
      const input = join(directory, `source.${extension}`), target = join(directory, extension); await mkdir(target);
      await run(['-i', source, '-c:v', codec, '-threads', '1', input]);
      expect((await readFile(await renderChatVideoFirstFrame(input, target))).subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    }
  }, 60_000);
  it('rejects a network playlist disguised as an uploaded MP4', async () => {
    const input = join(directory, 'fake.mp4'); await writeFile(input, '#EXTM3U\nhttps://example.invalid/private.mp4');
    await expect(renderChatVideoFirstFrame(input, directory)).rejects.toThrow();
  });
});
