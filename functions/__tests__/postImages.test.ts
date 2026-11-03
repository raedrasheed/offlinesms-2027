import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { clipFfmpegPath, clipMediaBinaryEnv } from '../src/clips/mediaBinary';
import { decodePostImage, sanitizePostImage, POST_IMAGE_MAX_BYTES } from '../src/social/postImages';

describe('Post image input', () => {
  it('rejects oversized, malformed, and non-image data before decoding', () => {
    expect(() => decodePostImage('a'.repeat(POST_IMAGE_MAX_BYTES * 2))).toThrow();
    expect(() => decodePostImage('data:image/png;base64,AAAA')).toThrow();
    expect(() => decodePostImage(Buffer.from('<svg/>').toString('base64'))).toThrow();
    expect(decodePostImage(undefined)).toBeNull();
  });
  it('decodes a real PNG and saves a bounded JPEG while rejecting corrupt content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'post-image-test-'));
    try {
      const png = join(dir, 'input.png');
      await promisify(execFile)(clipFfmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=64x48', '-frames:v', '1', '-threads', '1', png], { env: clipMediaBinaryEnv });
      const input = decodePostImage((await readFile(png)).toString('base64'))!;
      const output = await sanitizePostImage(input);
      expect(output.bytes.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
      expect(output.digest).toMatch(/^[a-f0-9]{64}$/);
      await expect(sanitizePostImage({ bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), codec: 'png' })).rejects.toThrow('post-image-cannot-decode');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
