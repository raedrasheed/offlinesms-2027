import * as FileSystem from 'expo-file-system';
import { toByteArray } from 'base64-js';

type ChatImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const HEADER_BYTES = 12;

function imageMimeFromHeader(bytes: Uint8Array): ChatImageMime | null {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((value, index) => bytes[offset + index] === value);
  if (startsWith([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith([0x47, 0x49, 0x46, 0x38]) &&
      (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

/**
 * Use the selected file's bytes, not a provider's MIME/extension or size. Expo
 * SDK 53's Android compressed picker can retain WebP metadata for JPEG output.
 * Only a short header is read; no re-encoding discards alpha or animation.
 * Full validation still happens on the server before the message is finalized.
 */
export async function prepareChatImage(input: { uri: string }): Promise<{
  uri: string;
  mimeType: ChatImageMime;
  sizeBytes: number;
}> {
  let uri = input.uri;
  let temporaryUri: string | undefined;
  try {
    let header: Uint8Array;
    let sizeBytes: number;
    if (/^(blob:|data:)/i.test(uri)) {
      // The web picker returns a browser URL; native FileSystem is unavailable.
      const response = await fetch(uri);
      if (!response.ok) throw new Error('image-unreadable');
      const blob = await response.blob();
      sizeBytes = blob.size;
      header = new Uint8Array(await blob.slice(0, HEADER_BYTES).arrayBuffer());
    } else {
      if (uri.startsWith('/')) uri = `file://${uri}`;
      if (uri.startsWith('content://')) {
        // SDK 53 can copy arbitrary Android providers, but its bounded reader
        // only understands file:// and a subset of Storage Access Framework URIs.
        if (!FileSystem.cacheDirectory) throw new Error('image-unreadable');
        temporaryUri = `${FileSystem.cacheDirectory}chat-image-${Date.now()}-${Math.random().toString(36).slice(2)}.image`;
        await FileSystem.copyAsync({ from: uri, to: temporaryUri });
        uri = temporaryUri;
      }
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || info.isDirectory) throw new Error('image-unreadable');
      sizeBytes = info.size;
      header = toByteArray(await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: 0,
        length: HEADER_BYTES,
      }));
    }
    const mimeType = imageMimeFromHeader(header);
    if (!mimeType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      throw new Error('image-invalid');
    }
    return { uri, mimeType, sizeBytes };
  } catch (error) {
    if (temporaryUri) await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(() => {});
    throw error;
  }
}
