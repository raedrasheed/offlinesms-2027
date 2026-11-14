import { attachmentLimit, attachmentMimeAllowed, inferAttachmentMime } from '../mobile/src/media/attachmentModel.ts';
import { findSticker } from '../mobile/src/lib/stickers.ts';

const storageOrigin = 'https://firebasestorage.googleapis.com';
const thumbnailLimit = 2 * 1024 * 1024;

function validSegment(value) {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..' && !/[/\\\x00-\x1f\x7f]/.test(value);
}

function messagePath(value, item) {
  if (typeof value !== 'string') return null;
  const parts = value.split('/');
  const sender = item.senderUid ?? item.senderId;
  if (parts.length !== 5 || parts[0] !== 'chatMedia' || !parts.slice(1).every(validSegment)
      || parts[1] !== item.conversationId || parts[2] !== sender || parts[3] !== item.id) return null;
  return value;
}

function authorizedUrl(value, bucket) {
  if (typeof value !== 'string' || typeof bucket !== 'string' || !bucket) return null;
  try {
    const url = new URL(value);
    if (url.origin !== storageOrigin || url.username || url.password || url.hash || url.searchParams.get('alt') !== 'media') return null;
    const parts = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
    if (!parts || decodeURIComponent(parts[1]) !== bucket) return null;
    return { src: url.href, path: decodeURIComponent(parts[2]) };
  } catch { return null; }
}

function sourcePath(path, storedUrl, item, bucket) {
  if (path != null && path !== '') return messagePath(path, item);
  return messagePath(authorizedUrl(storedUrl, bucket)?.path, item);
}

export function bundledSticker(sticker) {
  const known = findSticker(sticker?.packId, sticker?.stickerId);
  if (!known) return null;
  return { src: `/stickers/${known.packId}/${known.id}.webp`, fileName: `${known.packId}-${known.id}.webp`,
    contentType: 'image/webp', alt: known.alt };
}

export function createChatMediaSource({ getClient, isActive }) {
  const sources = new Map();
  const objectUrls = new Set();
  const requestedThumbnails = new Set();
  let pendingThumbnails = 0;

  function clear() {
    sources.clear();
    requestedThumbnails.clear();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  async function loadUrl(client, item, path, contentType, limit) {
    if (!path || !isActive(item)) throw new Error('media-unavailable');
    try {
      const url = authorizedUrl(await client.getMediaUrl(path), client.storageBucket);
      if (!isActive(item) || url?.path !== path) throw new Error('media-unavailable');
      return url.src;
    } catch (error) {
      if (error?.code !== 'storage/no-download-url' || !isActive(item)) throw error;
      const blob = await client.getMediaBlob(path, limit + 1);
      if (!isActive(item) || !blob.size || blob.size > limit) throw new Error('media-unavailable');
      const url = URL.createObjectURL(new Blob([blob], { type: contentType || blob.type || 'application/octet-stream' }));
      objectUrls.add(url);
      return url;
    }
  }

  async function generatePoster(client, item, bucket, path) {
    const media = item.media;
    if (item.type !== 'video' || media.uploadStatus !== 'uploaded' || pendingThumbnails >= 2
        || requestedThumbnails.size >= 30 || requestedThumbnails.has(path) || !isActive(item)) return undefined;
    requestedThumbnails.add(path);
    pendingThumbnails++;
    try {
      const result = await client.call('ensureChatVideoThumbnail', { conversationId: item.conversationId, messageId: item.id });
      if (result?.state !== 'ready' || !isActive(item)) return undefined;
      const firstFrame = sourcePath(result.thumbnailPath, result.thumbnailURL, item, bucket);
      if (firstFrame && firstFrame !== path) return loadUrl(client, item, firstFrame, 'image/jpeg', thumbnailLimit);
    } finally { pendingThumbnails--; }
  }

  function getDownloadInfo(item) {
    const client = getClient();
    const media = item.media;
    const ready = media && (media.uploadStatus === 'uploaded' || media.uploadStatus == null);
    if (!client || !ready || !isActive(item)) throw new Error('media-unavailable');
    const path = sourcePath(media.storagePath, media.downloadURL, item, client.storageBucket);
    if (!path) throw new Error('media-unavailable');
    const fileName = media.fileName || path.split('/').at(-1);
    const type = item.type === 'sticker' ? 'image' : item.type;
    const mime = inferAttachmentMime(fileName, media.mimeType);
    const contentType = attachmentMimeAllowed(type, mime) ? mime : 'application/octet-stream';
    return { path, fileName, type, contentType, sizeBytes: media.sizeBytes };
  }

  async function getDownloadUrl(item, path) {
    const client = getClient();
    if (getDownloadInfo(item).path !== path) throw new Error('media-unavailable');
    const url = authorizedUrl(await client.getMediaUrl(path), client.storageBucket);
    if (!isActive(item) || url?.path !== path || !new URL(url.src).searchParams.get('token')) {
      throw new Error('media-unavailable');
    }
    return url.src;
  }

  async function getMedia(item, { refresh = false } = {}) {
    const client = getClient();
    const media = item.media;
    const { path, fileName, type, contentType, sizeBytes } = getDownloadInfo(item);
    const key = JSON.stringify([path, type, fileName, contentType, media.thumbnailPath, media.thumbnailURL]);
    if (!refresh && sources.has(key)) return sources.get(key);
    const result = loadUrl(client, item, path, contentType, attachmentLimit(type)).then(async (src) => {
      if (!isActive(item)) throw new Error('media-unavailable');
      const info = { src, path, fileName, contentType, sizeBytes };
      const thumbnail = !item.isSticker && sourcePath(media.thumbnailPath, media.thumbnailURL, item, client.storageBucket);
      const savedPoster = thumbnail && thumbnail !== path
        ? () => loadUrl(client, item, thumbnail, 'image/jpeg', thumbnailLimit) : undefined;
      if (type === 'image' && savedPoster) info.preview = await savedPoster().catch(() => undefined);
      if (type === 'video') info.posterPromise = (savedPoster?.() ?? generatePoster(client, item, client.storageBucket, path)).catch(() => undefined);
      if (!isActive(item)) throw new Error('media-unavailable');
      return info;
    }).catch((error) => {
      if (sources.get(key) === result) sources.delete(key);
      throw error;
    });
    sources.set(key, result);
    return result;
  }

  return { getMedia, getDownloadInfo, getDownloadUrl, clear };
}
