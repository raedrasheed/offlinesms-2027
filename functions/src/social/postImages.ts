import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { HttpsError } from 'firebase-functions/v2/https';
import { clipFfmpegPath, clipFfprobePath, clipMediaBinaryEnv } from '../clips/mediaBinary';

const exec = promisify(execFile);
export const POST_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export function decodePostImage(value: unknown): { bytes: Buffer; codec: 'mjpeg' | 'png' } | null {
  if (value == null) return null;
  if (typeof value !== 'string' || !value || value.length > Math.ceil(POST_IMAGE_MAX_BYTES / 3) * 4
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    throw new HttpsError('invalid-argument', 'post-image-invalid');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > POST_IMAGE_MAX_BYTES) throw new HttpsError('invalid-argument', 'post-image-too-large');
  const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!jpeg && !png) throw new HttpsError('invalid-argument', 'post-image-format-invalid');
  return { bytes, codec: png ? 'png' : 'mjpeg' };
}

/** Only a validated still-image decoder is used; external protocols and metadata
 * are stripped. The saved JPEG has no original EXIF, location or download token.
 */
export async function sanitizePostImage(input: NonNullable<ReturnType<typeof decodePostImage>>) {
  const directory = await mkdtemp(join(tmpdir(), 'offlinesms-post-'));
  try {
    const source = join(directory, input.codec === 'png' ? 'source.png' : 'source.jpg'), output = join(directory, 'image.jpg');
    await writeFile(source, input.bytes);
    const { stdout } = await exec(clipFfprobePath, ['-v', 'error', '-max_alloc', '134217728', '-protocol_whitelist', 'file,pipe', '-f', 'image2', '-c:v', input.codec,
      '-show_entries', 'stream=width,height', '-of', 'json', source], { timeout: 15_000, maxBuffer: 64 * 1024, env: clipMediaBinaryEnv });
    const stream = JSON.parse(stdout).streams?.[0], width = stream?.width, height = stream?.height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 40_000_000)
      throw new Error('post-image-dimensions-invalid');
    await exec(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-max_alloc', '134217728', '-nostdin', '-y', '-threads', '1', '-filter_threads', '1',
      '-protocol_whitelist', 'file,pipe', '-f', 'image2', '-c:v', input.codec, '-i', source, '-frames:v', '1',
      '-vf', "scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease", '-map_metadata', '-1', '-c:v', 'mjpeg', '-q:v', '3', output],
    { timeout: 30_000, maxBuffer: 64 * 1024, env: clipMediaBinaryEnv });
    const bytes = await readFile(output);
    return { bytes, digest: createHash('sha256').update(bytes).digest('hex') };
  } catch { throw new HttpsError('invalid-argument', 'post-image-cannot-decode'); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
