import { resolve, join } from 'node:path';

/** Installed from a pinned archive with a checked SHA-256 by npm postinstall.
 * Source src/clips and compiled lib/clips share the same relative depth. */
export const clipMediaBinaryRoot = resolve(__dirname, '../../.media-tools');
export const clipFfmpegPath = join(clipMediaBinaryRoot, 'bin', 'ffmpeg');
export const clipFfprobePath = join(clipMediaBinaryRoot, 'bin', 'ffprobe');
export const clipMediaBinaryEnv = { ...process.env, LD_LIBRARY_PATH: join(clipMediaBinaryRoot, 'lib') };
