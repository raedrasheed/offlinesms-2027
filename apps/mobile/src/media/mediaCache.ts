// Persistent on-device media cache (WhatsApp-style folder layout).
//
// Received image/voice binaries live in Firebase Storage and would otherwise be
// re-fetched over the network on every render/playback. We download each one
// once into the app's document directory under:
//
//   <documentDirectory>/OfflineSMS/
//     Images/       <messageId>.<jpg|png|webp>
//     Recordings/   <messageId>.m4a
//
// so images render instantly and voice notes play from a local file (smooth,
// offline-capable). Files are keyed by the globally-unique message id, so the
// cache is self-deduplicating and never collides across users on one device.

import * as FileSystem from 'expo-file-system';
import type { Message } from '../lib/conversations';
import { setTransferProgress, setTransferFailed, clearTransfer } from './transferProgress';

const ROOT = `${FileSystem.documentDirectory}OfflineSMS/`;
const IMAGES_DIR = `${ROOT}Images/`;
const RECORDINGS_DIR = `${ROOT}Recordings/`;

export const mediaDirs = { root: ROOT, images: IMAGES_DIR, recordings: RECORDINGS_DIR };

function extFor(message: Message): string {
  if (message.type === 'voice') return 'm4a';
  const mime = message.media?.mimeType ?? '';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  return 'jpg';
}

function dirFor(message: Message): string {
  return message.type === 'voice' ? RECORDINGS_DIR : IMAGES_DIR;
}

/** Deterministic local path for a message's media (null if no id/not media). */
export function cachePathFor(message: Message): string | null {
  if (message.type !== 'image' && message.type !== 'voice') return null;
  const id = message.id;
  if (!id) return null;
  return `${dirFor(message)}${id}.${extFor(message)}`;
}

let dirsReady: Promise<void> | null = null;
function ensureDirs(): Promise<void> {
  if (!dirsReady) {
    dirsReady = (async () => {
      for (const d of [IMAGES_DIR, RECORDINGS_DIR]) {
        const info = await FileSystem.getInfoAsync(d);
        if (!info.exists) await FileSystem.makeDirectoryAsync(d, { intermediates: true });
      }
    })().catch((e) => { dirsReady = null; throw e; });
  }
  return dirsReady;
}

// Paths known to exist this session — skips a stat() on hot re-renders.
const known = new Set<string>();
// In-flight downloads keyed by path so concurrent renders share one request.
const inflight = new Map<string, Promise<string | null>>();

/**
 * Return a local file path for the message's media, downloading it into the
 * cache folder if it isn't there yet. Returns null when there's nothing to
 * cache (no download URL yet) — callers then fall back to the remote URL.
 */
export async function ensureCached(message: Message): Promise<string | null> {
  const path = cachePathFor(message);
  if (!path) return null;
  if (known.has(path)) return path;

  const info = await FileSystem.getInfoAsync(path);
  if (info.exists && !info.isDirectory && info.size > 0) { known.add(path); return path; }

  const existing = inflight.get(path);
  if (existing) return existing;

  const id = message.id;
  const localUri = message.media?.localUri || null;
  const url = message.media?.downloadURL || null;

  const task = (async () => {
    try {
      await ensureDirs();
      // Own sends: copy the original local file — no network round-trip.
      if (localUri) {
        const li = await FileSystem.getInfoAsync(localUri);
        if (li.exists && !li.isDirectory) {
          await FileSystem.copyAsync({ from: localUri, to: path });
          known.add(path);
          return path;
        }
      }
      if (!url) return null;
      // Received media: download with live progress so the % counter increments.
      const dl = FileSystem.createDownloadResumable(url, path, {}, (p) => {
        if (id && p.totalBytesExpectedToWrite > 0) {
          setTransferProgress(id, 'download', p.totalBytesWritten / p.totalBytesExpectedToWrite);
        }
      });
      const res = await dl.downloadAsync();
      if (res && res.status >= 200 && res.status < 300) {
        known.add(path);
        if (id) clearTransfer(id);
        return path;
      }
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      if (id) setTransferFailed(id, 'download');
      return null;
    } catch {
      await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
      if (id) setTransferFailed(id, 'download');
      return null;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, task);
  return task;
}

/** Re-attempt a failed download (clears the failed state, then re-fetches). */
export async function retryDownload(message: Message): Promise<string | null> {
  if (message.id) clearTransfer(message.id);
  return ensureCached(message);
}

/** Fire-and-forget cache of every media message in a list (background prefetch). */
export function prefetchMedia(messages: Message[]): void {
  for (const m of messages) {
    if ((m.type === 'image' || m.type === 'voice') && m.media?.downloadURL) {
      void ensureCached(m).catch(() => {});
    }
  }
}
