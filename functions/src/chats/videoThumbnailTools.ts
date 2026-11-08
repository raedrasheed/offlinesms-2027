import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { clipFfmpegPath, clipFfprobePath, clipMediaBinaryEnv } from '../clips/mediaBinary';

const exec = promisify(execFile);
export const CHAT_THUMBNAIL_MAX_BYTES = 512 * 1024;
/** Decode frame zero, not a representative frame or embedded cover artwork.
 * Reuses the pinned media binaries; input never includes a URL or shell text. */
export async function renderChatVideoFirstFrame(source: string, directory: string): Promise<string> {
  const limits = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm'];
  const { stdout } = await exec(clipFfprobePath, ['-v', 'error', ...limits, '-show_format', '-show_streams', '-of', 'json', source],
    { timeout: 15_000, maxBuffer: 1024 * 1024, env: clipMediaBinaryEnv });
  const probe = JSON.parse(stdout), streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream: any) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1);
  const format = String(probe.format?.format_name ?? '');
  if (!video || streams.length > 12 || !Number.isInteger(video.index) || video.index < 0
      || !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 1 || video.height < 1
      || video.width > 4096 || video.height > 4096 || !(format.includes('mov') || format.includes('matroska') || format.includes('webm')))
    throw new Error('chat-thumbnail-media-invalid');
  const output = join(directory, 'first-frame.jpg');
  await exec(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '1', '-filter_threads', '1',
    ...limits, '-i', source, '-map', `0:${video.index}`, '-frames:v', '1', '-an', '-sn', '-dn',
    '-vf', "scale='min(480,iw)':'min(480,ih)':force_original_aspect_ratio=decrease,setsar=1", '-q:v', '3',
    '-map_metadata', '-1', '-f', 'image2', '-update', '1', output],
  { timeout: 25_000, maxBuffer: 1024 * 1024, env: clipMediaBinaryEnv });
  const size = (await stat(output)).size;
  if (size < 3 || size > CHAT_THUMBNAIL_MAX_BYTES || !(await readFile(output)).subarray(0, 3).equals(Buffer.from([255, 216, 255])))
    throw new Error('chat-thumbnail-output-invalid');
  return output;
}
