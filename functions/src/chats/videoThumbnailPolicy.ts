import { createHash } from 'node:crypto';

export const CHAT_THUMBNAIL_VERSION = 1;
export const CHAT_THUMBNAIL_MAX_ATTEMPTS = 3;
export const CHAT_THUMBNAIL_LEASE_MS = 4 * 60_000;
export const CHAT_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
export const CHAT_VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'];
export type ChatVideoSource = { path: string; prefix: string; key: string; size: number; mime: string };
export type ChatThumbnailResult = { state: 'pending' | 'ready' | 'failed'; thumbnailPath?: string; thumbnailURL?: string };
export function validChatIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 1500 && !/[\/\x00-\x1f]/.test(value) && value !== '.' && value !== '..';
}
export function chatVideoSource(conversationId: string, messageId: string, message?: Record<string, any>): ChatVideoSource | null {
  if (!validChatIdentifier(conversationId) || !validChatIdentifier(messageId) || !message || message.type !== 'video'
      || message.deletedForEveryone || message.retentionDeleting || message.media?.uploadStatus !== 'uploaded') return null;
  const uid = message.senderUid ?? message.senderId, media = message.media;
  if (!validChatIdentifier(uid) || !Number.isSafeInteger(media.sizeBytes) || media.sizeBytes <= 0 || media.sizeBytes > CHAT_VIDEO_MAX_BYTES
      || !CHAT_VIDEO_MIMES.includes(media.mimeType)) return null;
  const prefix = `chatMedia/${conversationId}/${uid}/${messageId}/`;
  if (typeof media.storagePath !== 'string' || !media.storagePath.startsWith(prefix)) return null;
  const file = media.storagePath.slice(prefix.length);
  if (!file || file.includes('/') || file === '.' || file === '..' || file.startsWith('video-first-frame-')) return null;
  const key = createHash('sha256').update(JSON.stringify([media.storagePath, media.sizeBytes, media.mimeType])).digest('hex');
  return { path: media.storagePath, prefix, key, size: media.sizeBytes, mime: media.mimeType };
}
export function chatThumbnailResult(message: Record<string, any>, source: ChatVideoSource): ChatThumbnailResult {
  const media = message.media ?? {};
  if (media.thumbnailSourceKey !== source.key) return { state: 'pending' };
  const path = media.thumbnailPath;
  if (media.thumbnailVersion === CHAT_THUMBNAIL_VERSION && media.thumbnailState === 'ready'
      && typeof path === 'string' && path.startsWith(source.prefix)
      && /^video-first-frame-v1-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(path.slice(source.prefix.length))
      && typeof media.thumbnailURL === 'string' && media.thumbnailURL.startsWith('https://firebasestorage.googleapis.com/v0/b/')
      && media.thumbnailURL.includes(`/o/${encodeURIComponent(path)}?`))
    return { state: 'ready', thumbnailPath: path, thumbnailURL: media.thumbnailURL };
  return { state: media.thumbnailState === 'failed'
    || (media.thumbnailState !== 'processing' && (media.thumbnailAttempts ?? 0) >= CHAT_THUMBNAIL_MAX_ATTEMPTS) ? 'failed' : 'pending' };
}
export function shouldGenerateChatThumbnail(conversationId: string, messageId: string, before: Record<string, any> | undefined, after: Record<string, any> | undefined): boolean {
  const source = chatVideoSource(conversationId, messageId, after);
  if (!source || chatThumbnailResult(after!, source).state !== 'pending') return false;
  const prior = chatVideoSource(conversationId, messageId, before);
  return prior?.key !== source.key || before?.media?.thumbnailRequestId !== after?.media?.thumbnailRequestId;
}
