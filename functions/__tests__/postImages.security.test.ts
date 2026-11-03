import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { clipFfmpegPath, clipFfprobePath, clipMediaBinaryEnv } from '../src/clips/mediaBinary';
import { decodePostImage, POST_IMAGE_MAX_BYTES, sanitizePostImage } from '../src/social/postImages';

const exec = promisify(execFile);
let directory: string;
let jpeg: Buffer, png: Buffer, tooWide: Buffer;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'post-images-security-'));
  for (const [name, size] of [['source.jpg', '320x240'], ['source.png', '320x240'], ['too-wide.png', '9000x10']]) {
    await exec(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=blue:s=${size}`,
      '-frames:v', '1', '-threads', '1', join(directory, name)], { timeout: 15_000, env: clipMediaBinaryEnv });
  }
  [jpeg, png, tooWide] = await Promise.all(['source.jpg', 'source.png', 'too-wide.png'].map(name => readFile(join(directory, name))));
}, 50_000);
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

describe('post images from actual untrusted bytes', () => {
  it.each(['jpeg', 'png'])('decodes %s and emits a still JPEG with bounded dimensions', async kind => {
    const input = decodePostImage((kind === 'jpeg' ? jpeg : png).toString('base64'))!;
    const sanitized = await sanitizePostImage(input);
    expect(sanitized.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(sanitized.bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    const output = join(directory, `${kind}-output.jpg`); await writeFile(output, sanitized.bytes);
    const { stdout } = await exec(clipFfprobePath, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', output], { env: clipMediaBinaryEnv });
    expect(JSON.parse(stdout).streams).toEqual([{ codec_name: 'mjpeg', width: 320, height: 240 }]);
  }, 30_000);

  it('reencodes away private metadata rather than serving the supplied JPEG bytes', async () => {
    const secret = Buffer.from('PRIVATE GPS=31.5000,34.4500 DeviceSerial=test-private');
    const marker = Buffer.alloc(4); marker[0] = 255; marker[1] = 254; marker.writeUInt16BE(secret.length + 2, 2);
    const withComment = Buffer.concat([jpeg.subarray(0, 2), marker, secret, jpeg.subarray(2)]);
    const out = await sanitizePostImage(decodePostImage(withComment.toString('base64'))!);
    expect(out.bytes.includes(secret)).toBe(false);
  });

  it('rejects a valid image with excessive dimensions before conversion', async () => {
    await expect(sanitizePostImage(decodePostImage(tooWide.toString('base64'))!)).rejects.toThrow('post-image-cannot-decode');
  });

  it('does not reinterpret forged image magic as a network/local-file playlist', async () => {
    const fake = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.from('#EXTM3U\nfile:///etc/passwd\nhttps://example.invalid/private')]);
    await expect(sanitizePostImage(decodePostImage(fake.toString('base64'))!)).rejects.toThrow('post-image-cannot-decode');
  });

  it('bounds decoded size and rejects malformed base64 or a non-image document', () => {
    const oversize = Buffer.alloc(POST_IMAGE_MAX_BYTES + 1); oversize[0] = 255; oversize[1] = 216; oversize[2] = 255;
    for (const payload of [oversize.toString('base64'), '%%%=', 'AAAA\nAAAA', Buffer.from('<svg onload="alert(1)"></svg>').toString('base64')]) {
      expect(() => decodePostImage(payload)).toThrow();
    }
    expect(decodePostImage(null)).toBeNull();
  });
});
