import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { clipFfmpegPath, clipFfprobePath, clipMediaBinaryEnv } from './mediaBinary';

const exec = promisify(execFile);
export const CLIP_SOURCE_MAX_MS = 10 * 60_000;
export const CLIP_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
export interface ClipEdits {
  trimStartMs: number; trimEndMs: number; coverTimeMs: number; overlayText: string; mute: boolean;
}
export interface VideoProbe { durationMs: number; width: number; height: number; hasAudio: boolean; format: 'mov' | 'matroska' }

export function validateClipEdits(raw: Record<string, unknown>, maxDurationSeconds: number): ClipEdits {
  const { trimStartMs, trimEndMs, coverTimeMs } = raw;
  if (![trimStartMs, trimEndMs, coverTimeMs].every(x => typeof x === 'number' && Number.isFinite(x)))
    throw new Error('clip-trim-invalid');
  const start = Math.floor(trimStartMs as number), end = Math.floor(trimEndMs as number), cover = Math.floor(coverTimeMs as number);
  if (start < 0 || end <= start || end > CLIP_SOURCE_MAX_MS || end - start > maxDurationSeconds * 1000
      || cover < start || cover >= end) throw new Error('clip-trim-invalid');
  const overlayText = typeof raw.overlayText === 'string' ? raw.overlayText.trim() : '';
  if (overlayText.length > 100 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(overlayText))
    throw new Error('clip-overlay-invalid');
  if (typeof raw.mute !== 'boolean') throw new Error('clip-mute-invalid');
  return { trimStartMs: start, trimEndMs: end, coverTimeMs: cover, overlayText, mute: raw.mute };
}

/** No shell is invoked. Accept only uploaded MP4/MOV/WebM containers and local
 * file/pipe protocols, preventing playlist/network protocols in hostile input. */
export async function probeClipVideo(path: string): Promise<VideoProbe> {
  const { stdout } = await exec(clipFfprobePath, ['-v', 'error', '-protocol_whitelist', 'file,pipe',
    '-format_whitelist', 'mov,matroska,webm', '-show_format', '-show_streams', '-of', 'json', path],
  { timeout: 30_000, maxBuffer: 1024 * 1024, env: clipMediaBinaryEnv });
  const data = JSON.parse(stdout);
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find((s: any) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const durationMs = Math.round(Number(data.format?.duration ?? video?.duration) * 1000);
  const width = Number(video?.width), height = Number(video?.height);
  const name = String(data.format?.format_name ?? '');
  if (!video || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > CLIP_SOURCE_MAX_MS
      || !Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16
      || width > 4096 || height > 4096 || streams.length > 12
      || !(name.includes('mov') || name.includes('matroska') || name.includes('webm')))
    throw new Error('clip-media-invalid');
  return { durationMs, width, height, hasAudio: streams.some((s: any) => s.codec_type === 'audio'),
    format: name.includes('mov') ? 'mov' : 'matroska' };
}

function wrapOverlay(text: string): string {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line && line.length + word.length + 1 > 26) { lines.push(line); line = ''; }
      line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
  }
  return lines.join('\n');
}
function scaleFilter(width: number, height: number): string {
  return `scale='min(${width},iw)':'min(${height},ih)':force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`;
}
async function runFfmpeg(args: string[], timeout = 180_000): Promise<void> {
  await exec(clipFfmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '1', '-filter_threads', '1', ...args],
    { timeout, maxBuffer: 1024 * 1024, env: clipMediaBinaryEnv });
}

export async function renderClipVideo(source: string, directory: string, edits: ClipEdits) {
  const probe = await probeClipVideo(source);
  if (edits.trimEndMs > probe.durationMs + 100 || edits.trimStartMs >= probe.durationMs)
    throw new Error('clip-trim-outside-source');
  const standard = join(directory, 'standard.mp4'), dataSaver = join(directory, 'dataSaver.mp4'), cover = join(directory, 'cover.jpg');
  let filter = scaleFilter(720, 1280);
  if (edits.overlayText) {
    const textFile = join(directory, 'overlay.txt');
    await writeFile(textFile, wrapOverlay(edits.overlayText), 'utf8');
    const font = resolve(__dirname, '../../assets/fonts/DejaVuSans.ttf');
    // Compiled lib/clips and source src/clips have identical relative depth.
    filter += `,drawtext=fontfile='${font}':textfile='${textFile}':expansion=none:fontcolor=white:fontsize=h/24:box=1:boxcolor=black@0.55:boxborderw=10:x=(w-text_w)/2:y=h*0.72`;
  }
  const length = Math.min(edits.trimEndMs, probe.durationMs) - edits.trimStartMs;
  await runFfmpeg(['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm',
    '-ss', (edits.trimStartMs / 1000).toFixed(3), '-f', probe.format, '-i', source,
    '-t', (length / 1000).toFixed(3), '-map', '0:v:0', ...(!edits.mute && probe.hasAudio ? ['-map', '0:a:0'] : []),
    '-vf', filter, '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p',
    '-r', '30', ...(!edits.mute && probe.hasAudio ? ['-c:a', 'aac', '-b:a', '96k', '-ac', '2'] : ['-an']),
    '-map_metadata', '-1', '-movflags', '+faststart', standard]);
  await runFfmpeg(['-i', standard, '-vf', scaleFilter(360, 640), '-c:v', 'libx264', '-threads', '1', '-preset', 'veryfast', '-crf', '30',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-map_metadata', '-1', '-movflags', '+faststart', dataSaver]);
  const coverSecond = Math.min(Math.max(0, edits.coverTimeMs - edits.trimStartMs), Math.max(0, length - 100)) / 1000;
  await runFfmpeg(['-ss', coverSecond.toFixed(3), '-i', standard, '-frames:v', '1', '-vf', scaleFilter(360, 640), '-q:v', '3', cover]);
  const final = await probeClipVideo(standard);
  return { standard, dataSaver, cover, durationMs: final.durationMs, width: final.width, height: final.height };
}
