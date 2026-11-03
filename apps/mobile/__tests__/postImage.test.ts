import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ pick: vi.fn(), info: vi.fn(), remove: vi.fn(), resize: vi.fn(), render: vi.fn(), save: vi.fn(), releaseImage: vi.fn(), releaseContext: vi.fn() }));
vi.mock('expo-image-picker', () => ({ launchImageLibraryAsync: mock.pick }));
vi.mock('expo-file-system', () => ({ getInfoAsync: mock.info, deleteAsync: mock.remove }));
vi.mock('expo-image-manipulator', () => ({ SaveFormat: { JPEG: 'jpeg' }, ImageManipulator: { manipulate: () => ({ resize: mock.resize, renderAsync: mock.render, release: mock.releaseContext }) } }));
import { pickPostImage } from '../src/lib/postImage';
beforeEach(() => {
  vi.clearAllMocks(); mock.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///source.png', width: 4000, height: 3000 }] });
  mock.info.mockResolvedValue({ exists: true, isDirectory: false, size: 100_000 });
  mock.render.mockResolvedValue({ saveAsync: mock.save, release: mock.releaseImage });
  mock.save.mockResolvedValue({ uri: 'file:///normalized.jpg', base64: 'a'.repeat(400) }); mock.remove.mockResolvedValue(undefined);
});
describe('Post photo upload preparation', () => {
  it('normalizes the original to a bounded JPEG and releases native image handles', async () => {
    expect(await pickPostImage()).toEqual({ uri: 'file:///normalized.jpg', base64: 'a'.repeat(400) });
    expect(mock.resize).toHaveBeenCalledWith({ width: 1440 });
    expect(mock.save).toHaveBeenCalledWith({ format: 'jpeg', compress: .8, base64: true });
    expect(mock.releaseImage).toHaveBeenCalledOnce(); expect(mock.releaseContext).toHaveBeenCalledOnce();
  });
  it('recompresses oversized output and deletes the rejected temporary image', async () => {
    mock.save.mockResolvedValueOnce({ uri: 'file:///large.jpg', base64: 'a'.repeat(4 * 1024 * 1024 + 4) });
    await pickPostImage();
    expect(mock.remove).toHaveBeenCalledWith('file:///large.jpg', { idempotent: true });
    expect(mock.save.mock.calls[1][0].compress).toBe(.55);
  });
  it('rejects unsafe source sizes or dimensions before native decoding', async () => {
    mock.pick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///huge.png', width: 10000, height: 10000 }] });
    await expect(pickPostImage()).rejects.toThrow('post-image-too-large'); expect(mock.render).not.toHaveBeenCalled();
  });
  it('cancels without producing an upload and releases the context if rendering fails', async () => {
    mock.pick.mockResolvedValueOnce({ canceled: true }); expect(await pickPostImage()).toBeNull(); expect(mock.info).not.toHaveBeenCalled();
    mock.render.mockRejectedValueOnce(Error('decode'));
    await expect(pickPostImage()).rejects.toThrow('decode'); expect(mock.releaseContext).toHaveBeenCalledOnce();
  });
});
