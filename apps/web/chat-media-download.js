import {
  attachmentLimit, attachmentMimeAllowed, inferAttachmentMime, isBinaryAttachment, MIME_EXTENSIONS,
} from '../mobile/src/media/attachmentModel.ts';

const bundledSticker = /^\/stickers\/[a-z0-9_-]+\/[a-z0-9_-]+\.(?:webp|png|gif)$/i;
const windowsDevice = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i;
const binaryMime = 'application/octet-stream';

function trustedDownloadUrl(value, type) {
  return type === 'sticker' && typeof value === 'string' && bundledSticker.test(value)
    ? new URL(value, location.origin).href : null;
}

function saveName(value, type, mime) {
  const fallback = `OfflineSMS-${type}`;
  const input = typeof value === 'string' ? value : '';
  const safe = (input.split(/[\\/]/).pop() ?? '').normalize('NFC')
    .replace(/[\x00-\x1f\x7f-\x9f<>:"|?*\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '');
  const previous = safe.match(/\.([a-z0-9]{1,10})$/i);
  const extension = MIME_EXTENSIONS[mime] ?? 'bin';
  const suffix = previous && (previous[1].toLowerCase() === extension || (mime === 'image/jpeg' && previous[1].toLowerCase() === 'jpeg'))
    ? previous[0] : `.${extension}`;
  const base = (previous ? safe.slice(0, -previous[0].length) : safe).trim().replace(/[.\s]+$/g, '');
  const clean = windowsDevice.test(base) ? `_${base}` : base;
  return [...(clean || fallback)].slice(0, 120 - suffix.length).join('') + suffix;
}

function safeMime(blobType, declaredType, fileName, attachmentType) {
  const clean = (value) => typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : '';
  const actual = clean(blobType);
  if (actual && actual !== binaryMime) {
    if (!attachmentMimeAllowed(attachmentType, actual)) throw new Error('invalid-media-download-type');
    return actual;
  }
  const declared = clean(declaredType);
  if (attachmentMimeAllowed(attachmentType, declared)) return declared;
  const inferred = inferAttachmentMime(typeof fileName === 'string' ? fileName : '');
  return attachmentMimeAllowed(attachmentType, inferred) ? inferred : binaryMime;
}

async function fetchBlob(url, limit, signal) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', signal });
  if (response.status >= 500 || response.status === 429) return null;
  if (response.status !== 200 || (response.url && response.url !== url)) throw new Error('media-download-unavailable');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('media-download-too-large');
  if (!response.body?.getReader) return response.blob();

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('media-download-too-large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
}

export async function downloadChatMedia({ url, getUrl, getBlob, fileName, type, mimeType, expectedSize, signal, isActive = () => true }) {
  const attachmentType = type === 'sticker' ? 'image' : type;
  if (!isBinaryAttachment(attachmentType)) throw new Error('invalid-media-download-type');
  const limit = attachmentLimit(attachmentType);
  const checkActive = () => {
    if (signal?.aborted || !isActive()) throw new DOMException('Download cancelled', 'AbortError');
  };
  checkActive();

  let blob;
  if (getUrl) {
    // Resolve the original object through Firebase authorization on each click.
    const authorized = await getUrl().catch((error) => {
      if (error?.code !== 'storage/no-download-url') throw error;
      return null;
    });
    checkActive();
    if (authorized) {
      blob = await fetchBlob(authorized, limit, signal).catch((error) => {
        if (error?.name !== 'TypeError') throw error;
        return null;
      });
    }
    checkActive();
    // The SDK can truncate an object at maxBytes. Read one extra byte to detect oversize files.
    if (!blob) blob = await getBlob(limit + 1);
  } else {
    const trusted = trustedDownloadUrl(url, type);
    if (!trusted) throw new Error('media-download-url-invalid');
    blob = await fetchBlob(trusted, limit, signal);
  }
  checkActive();
  if (!blob || !Number.isFinite(blob.size) || blob.size <= 0) throw new Error('media-download-empty');
  if (blob.size > limit) throw new Error('media-download-too-large');
  if (Number.isSafeInteger(expectedSize) && expectedSize > 0 && blob.size !== expectedSize) {
    throw new Error('media-download-size-mismatch');
  }
  const mime = safeMime(blob.type, mimeType, fileName, attachmentType);
  const name = saveName(fileName, type, mime);
  const objectUrl = URL.createObjectURL(blob.type === mime ? blob : blob.slice(0, blob.size, mime));
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = name;
  link.hidden = true;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Safari can read a download URL after click dispatch returns.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
  return name;
}
