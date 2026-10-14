import { describe, expect, it, vi } from 'vitest';
const fs = vi.hoisted(() => ({ files: new Set<string>(), pending: [] as Array<() => void>, active: 0, peak: 0, downloads: 0 }));
vi.mock('expo-file-system', () => ({
  documentDirectory: 'file:///test/',
  getInfoAsync: async (path: string) => ({ exists: fs.files.has(path), isDirectory: false, size: fs.files.has(path) ? 3 : 0 }),
  makeDirectoryAsync: async () => {},
  copyAsync: async ({ to }: any) => { fs.files.add(to); },
  moveAsync: async ({ from, to }: any) => { fs.files.delete(from); fs.files.add(to); },
  deleteAsync: async (path: string) => { fs.files.delete(path); },
  createDownloadResumable: (_url: string, path: string) => ({
    downloadAsync: () => new Promise(resolve => {
      fs.downloads++; fs.active++; fs.peak = Math.max(fs.peak, fs.active);
      fs.pending.push(() => { fs.active--; fs.files.add(path); resolve({ status: 200, uri: path }); });
    }),
  }),
}));
vi.mock('../src/media/transferProgress', () => ({ setTransferProgress: vi.fn(), setTransferFailed: vi.fn(), clearTransfer: vi.fn() }));
import { ensureCached, cachedMediaUri, onMediaCached, cachePathFor } from '../src/media/mediaCache';
const message = (id: string) => ({ id, type: 'image', media: { downloadURL: `https://example.test/${id}` } } as any);
const tick = () => new Promise(r => setTimeout(r, 0));
describe('viewport media cache', () => {
  it('inspecting an offscreen cell never starts a network transfer', async () => {
    const before = fs.downloads;
    expect(await cachedMediaUri(message('offscreen'))).toBeNull();
    expect(fs.downloads).toBe(before);
  });
  it('limits original downloads to three, deduplicates, and publishes complete files after rename', async () => {
    const m = message('first'); const onReady = vi.fn(); const stop = onMediaCached(m, onReady);
    const first = ensureCached(m); const duplicate = ensureCached(m);
    const rest = Array.from({ length: 5 }, (_, i) => ensureCached(message(`other${i}`)));
    await tick(); await tick();
    expect(fs.active).toBe(3); expect(fs.downloads).toBe(3);
    expect(await cachedMediaUri(m)).toBeNull();
    expect(onReady).not.toHaveBeenCalled();
    while (fs.pending.length) { fs.pending.splice(0).forEach(resolve => resolve()); await tick(); }
    const values = await Promise.all([first, duplicate, ...rest]); stop();
    expect(values[0]).toBe(values[1]); expect(fs.downloads).toBe(6); expect(fs.peak).toBe(3);
    expect(onReady).toHaveBeenCalledWith(cachePathFor(m));
    expect(await cachedMediaUri(m)).toBe(cachePathFor(m));
    expect([...fs.files].some(path => path.endsWith('.part'))).toBe(false);
  });
});
