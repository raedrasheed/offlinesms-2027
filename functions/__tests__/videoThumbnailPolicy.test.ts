import { describe, expect, it } from 'vitest';
import { chatThumbnailResult, chatVideoSource, shouldGenerateChatThumbnail } from '../src/chats/videoThumbnailPolicy';

const message = () => ({ type: 'video', senderUid: 'sender', media: { uploadStatus: 'uploaded', storagePath: 'chatMedia/c/sender/m/video.mp4', sizeBytes: 123, mimeType: 'video/mp4' } });
describe('chat video thumbnail policy', () => {
  it('accepts only a live uploaded video in its own canonical message prefix', () => {
    expect(chatVideoSource('c', 'm', message())).toMatchObject({ prefix: 'chatMedia/c/sender/m/', size: 123 });
    for (const change of [{ type: 'image' }, { deletedForEveryone: true }, { retentionDeleting: true }, { senderUid: 'other' }])
      expect(chatVideoSource('c', 'm', { ...message(), ...change })).toBeNull();
    for (const media of [{ uploadStatus: 'pending' }, { sizeBytes: 0 }, { sizeBytes: 26 * 1024 * 1024 }, { mimeType: 'image/jpeg' },
      { storagePath: 'https://attacker.test/video.mp4' }, { storagePath: 'chatMedia/c/sender/m/sub/video.mp4' },
      { storagePath: 'chatMedia/other/sender/m/video.mp4' }, { storagePath: 'chatMedia/c/sender/m/video-first-frame-malicious.mp4' }])
      expect(chatVideoSource('c', 'm', { ...message(), media: { ...message().media, ...media } })).toBeNull();
  });
  it('triggers for a new upload, ready forward, changed source or explicit backfill only', () => {
    const m = message();
    expect(shouldGenerateChatThumbnail('c', 'm', undefined, m)).toBe(true);
    expect(shouldGenerateChatThumbnail('c', 'm', { ...m, media: { ...m.media, uploadStatus: 'pending' } }, m)).toBe(true);
    expect(shouldGenerateChatThumbnail('c', 'm', m, { ...m, media: { ...m.media, thumbnailRequestId: 'request' } })).toBe(true);
    expect(shouldGenerateChatThumbnail('c', 'm', m, { ...m, media: { ...m.media, thumbnailState: 'processing', thumbnailAttempts: 1 } })).toBe(false);
    expect(shouldGenerateChatThumbnail('c', 'm', m, { ...m, caption: 'new caption' })).toBe(false);
    expect(shouldGenerateChatThumbnail('c', 'm', m, undefined)).toBe(false);
  });
  it('returns only the matching generated preview and never a foreign thumbnail', () => {
    const m = message(), source = chatVideoSource('c', 'm', m)!;
    const path = `${source.prefix}video-first-frame-v1-01234567-89ab-cdef-0123-456789abcdef.jpg`;
    const ready = { ...m, media: { ...m.media, thumbnailSourceKey: source.key, thumbnailVersion: 1, thumbnailState: 'ready', thumbnailPath: path,
      thumbnailURL: `https://firebasestorage.googleapis.com/v0/b/bucket/o/${encodeURIComponent(path)}?alt=media&token=t` } };
    expect(chatThumbnailResult(ready, source)).toEqual({ state: 'ready', thumbnailPath: path, thumbnailURL: ready.media.thumbnailURL });
    expect(chatThumbnailResult({ ...ready, media: { ...ready.media, thumbnailPath: 'other/path.jpg' } }, source)).toEqual({ state: 'pending' });
    expect(chatThumbnailResult({ ...ready, media: { ...ready.media, thumbnailURL: 'https://attacker.test/image.jpg' } }, source)).toEqual({ state: 'pending' });
    expect(chatThumbnailResult(ready, { ...source, key: 'different-source' })).toEqual({ state: 'pending' });
  });
  it('does not declare the third active attempt failed before it finishes', () => {
    const m = message(), source = chatVideoSource('c', 'm', m)!;
    const media = { ...m.media, thumbnailSourceKey: source.key, thumbnailAttempts: 3, thumbnailState: 'processing' };
    expect(chatThumbnailResult({ ...m, media }, source)).toEqual({ state: 'pending' });
    expect(chatThumbnailResult({ ...m, media: { ...media, thumbnailState: 'pending' } }, source)).toEqual({ state: 'failed' });
    expect(chatThumbnailResult({ ...m, media: { ...media, thumbnailState: 'failed' } }, source)).toEqual({ state: 'failed' });
  });
});
