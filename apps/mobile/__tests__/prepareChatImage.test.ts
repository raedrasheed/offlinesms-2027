import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({
  getInfoAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  copyAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));
vi.mock('expo-file-system', () => ({
  ...fs,
  cacheDirectory: 'file:///cache/',
  EncodingType: { Base64: 'base64' },
}));

import { prepareChatImage } from '../src/media/prepareChatImage';

const webp = [0x52, 0x49, 0x46, 0x46, 32, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const jpeg = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1];
const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];
const gif = Array.from(Buffer.from('GIF89a')).concat([1, 0, 1, 0, 0, 0]);

function setFile(bytes: number[], size = 2048) {
  fs.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size });
  fs.readAsStringAsync.mockResolvedValue(Buffer.from(bytes).toString('base64'));
}

beforeEach(() => {
  vi.resetAllMocks();
  fs.copyAsync.mockResolvedValue(undefined);
  fs.deleteAsync.mockResolvedValue(undefined);
  setFile(webp);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('chat image metadata follows the selected bytes', () => {
  it.each([undefined, '', 'application/octet-stream', 'image/*', 'image/jpeg'])
    ('recognizes WebP when provider MIME is %s', async mimeType => {
      const asset = { uri: 'file:///picker/opaque', mimeType, fileSize: 999 };
      await expect(prepareChatImage(asset)).resolves.toEqual({
        uri: asset.uri, mimeType: 'image/webp', sizeBytes: 2048,
      });
      expect(fs.readAsStringAsync).toHaveBeenCalledWith(asset.uri, {
        encoding: 'base64', position: 0, length: 12,
      });
      expect(fs.copyAsync).not.toHaveBeenCalled();
    });

  it('corrects SDK 53 compressed JPEG bytes labeled as WebP, including stale source size', async () => {
    setFile(jpeg, 321);
    const asset = { uri: 'file:///picker/photo.webp', mimeType: 'image/webp', fileSize: 7000 };
    await expect(prepareChatImage(asset)).resolves.toEqual({
      uri: asset.uri, mimeType: 'image/jpeg', sizeBytes: 321,
    });
  });

  it.each([
    { bytes: png, mimeType: 'image/png' },
    { bytes: gif, mimeType: 'image/gif' },
    { bytes: jpeg, mimeType: 'image/jpeg' },
  ])('identifies $mimeType without relying on its filename', async ({ bytes, mimeType }) => {
    setFile(bytes);
    await expect(prepareChatImage({ uri: 'file:///cache/no-extension' })).resolves.toMatchObject({ mimeType });
  });

  it('does not classify a different RIFF container as WebP', async () => {
    setFile(webp.slice(0, 8).concat(Array.from(Buffer.from('WAVE'))));
    await expect(prepareChatImage({ uri: 'file:///cache/photo.webp' })).rejects.toThrow('image-invalid');
  });

  it('rejects truncated and unsupported bytes instead of defaulting to JPEG', async () => {
    for (const bytes of [[], [0xff, 0xd8], webp.slice(0, 11), Array.from(Buffer.from('not an image'))]) {
      setFile(bytes);
      await expect(prepareChatImage({ uri: 'file:///cache/photo.jpg' })).rejects.toThrow('image-invalid');
    }
  });

  it('rejects a missing file before reading its contents', async () => {
    fs.getInfoAsync.mockResolvedValue({ exists: false });
    await expect(prepareChatImage({ uri: 'file:///cache/missing' })).rejects.toThrow('image-unreadable');
    expect(fs.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('normalizes absolute native paths from a share provider', async () => {
    await expect(prepareChatImage({ uri: '/cache/shared.webp' })).resolves.toMatchObject({
      uri: 'file:///cache/shared.webp', mimeType: 'image/webp',
    });
  });
});

describe('Android content providers', () => {
  it('copies the original into readable cache and uses that exact file for preview/upload', async () => {
    const source = 'content://com.example.provider/opaque-id';
    const result = await prepareChatImage({ uri: source });
    expect(result).toMatchObject({ mimeType: 'image/webp', sizeBytes: 2048 });
    expect(result.uri).toMatch(/^file:\/\/\/cache\/chat-image-.+\.image$/);
    expect(fs.copyAsync).toHaveBeenCalledWith({ from: source, to: result.uri });
    expect(fs.readAsStringAsync).toHaveBeenCalledWith(result.uri, expect.objectContaining({ length: 12 }));
    expect(fs.deleteAsync).not.toHaveBeenCalled();
  });

  it('removes a temporary copy if image preparation fails', async () => {
    setFile([0, 0, 0]);
    await expect(prepareChatImage({ uri: 'content://provider/bad' })).rejects.toThrow('image-invalid');
    const copiedUri = fs.copyAsync.mock.calls[0][0].to;
    expect(fs.deleteAsync).toHaveBeenCalledWith(copiedUri, { idempotent: true });
  });
});

describe('web picker URLs', () => {
  it.each(['blob:https://app.example/123', 'data:application/octet-stream;base64,opaque'])
    ('reads %s through the browser blob without native filesystem calls', async uri => {
      const blob = new Blob([new Uint8Array(webp)], { type: 'application/octet-stream' });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
      vi.stubGlobal('fetch', fetchMock);
      await expect(prepareChatImage({ uri })).resolves.toEqual({ uri, mimeType: 'image/webp', sizeBytes: 12 });
      expect(fetchMock).toHaveBeenCalledWith(uri);
      expect(fs.getInfoAsync).not.toHaveBeenCalled();
      expect(fs.readAsStringAsync).not.toHaveBeenCalled();
    });
});
