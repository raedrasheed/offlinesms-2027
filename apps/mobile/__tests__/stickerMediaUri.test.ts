import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const cache = vi.hoisted(() => ({ get: vi.fn(), listeners: new Map<string, (uri: string) => void>() }));
vi.mock('../src/media/mediaCache', () => ({ cachedMediaUri: cache.get,
  onMediaCached: (message: any, next: (uri: string) => void) => { cache.listeners.set(message.id, next); return () => {}; },
}));
import { useCachedMediaUri } from '../src/hooks/useCachedMediaUri';
const base: any = { id: 'cat', conversationId: 'c', type: 'image', media: { presentation: 'sticker',
  mimeType: 'image/png', sizeBytes: 1000, width: 512, height: 512,
  downloadURL: 'https://example.test/cat.png', thumbnailURL: 'https://example.test/opaque.jpg' } };
let renderer: ReactTestRenderer | undefined;
const frames: Array<string | null> = [];
function Harness({ message }: { message: any }) { frames.push(useCachedMediaUri(message)); return null; }
beforeEach(() => { vi.clearAllMocks(); frames.length = 0; cache.listeners.clear(); cache.get.mockResolvedValue(null); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(async () => { if (renderer) await act(async () => { renderer!.unmount(); }); renderer = undefined; vi.unstubAllGlobals(); });
describe('original transparent sticker media', () => {
  it('never substitutes an opaque thumbnail for a new or legacy sticker PNG', async () => {
    await act(async () => { renderer = create(createElement(Harness, { message: base })); });
    expect(frames.at(-1)).toBe(base.media.downloadURL);
    expect(frames).not.toContain(base.media.thumbnailURL);
    await act(async () => { renderer!.update(createElement(Harness, { message: { ...base, media: { ...base.media, presentation: null, fileName: 'sticker-cat.png' } } })); });
    expect(frames.at(-1)).toBe(base.media.downloadURL);
    expect(frames).not.toContain(base.media.thumbnailURL);
  });
  it('keeps thumbnail-first previews for ordinary photos', async () => {
    await act(async () => { renderer = create(createElement(Harness, { message: { ...base, media: { ...base.media, presentation: null, fileName: 'photo.png' } } })); });
    expect(frames.at(-1)).toBe(base.media.thumbnailURL);
  });
  it('uses the cached original but never renders an old cell’s cached image after a source change', async () => {
    await act(async () => { renderer = create(createElement(Harness, { message: base })); });
    const oldCallback = cache.listeners.get('cat')!;
    await act(async () => { oldCallback('file:///cat.png'); });
    expect(frames.at(-1)).toBe('file:///cat.png'); frames.length = 0;
    const next = { ...base, id: 'dog', media: { ...base.media, downloadURL: 'https://example.test/dog.png' } };
    await act(async () => { renderer!.update(createElement(Harness, { message: next })); });
    await act(async () => { oldCallback('file:///late-cat.png'); });
    expect(frames).not.toContain('file:///cat.png'); expect(frames).not.toContain('file:///late-cat.png');
    expect(frames.at(-1)).toBe(next.media.downloadURL);
  });
});
