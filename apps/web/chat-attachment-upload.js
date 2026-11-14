import {
  attachmentLimit, attachmentMimeAllowed, cleanFileName, inferAttachmentMime, MIME_EXTENSIONS,
} from '../mobile/src/media/attachmentModel.ts';
import { validMediaDimensions } from '../mobile/src/media/mediaDimensions.ts';

const supportedTypes = ['image', 'video', 'audio', 'file'];
const captionLimit = 1000;

function attachmentError(code) {
  return Object.assign(new Error(code), { code });
}

function attachmentMetadata(file, requestedType, caption) {
  const type = requestedType === 'gif' ? 'image' : requestedType;
  if (!supportedTypes.includes(type)) throw attachmentError('attachment-unsupported-type');
  if (!file || typeof file.slice !== 'function' || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw attachmentError('attachment-invalid');
  }
  if (file.size > attachmentLimit(type)) throw attachmentError('attachment-too-large');
  if (typeof caption !== 'string') throw attachmentError('attachment-invalid');
  if (caption.length > captionLimit) throw attachmentError('attachment-caption-too-long');

  const name = cleanFileName(file.name);
  const normalizedName = name.replace(/\.jpeg$/i, '.jpg');
  const mimeType = inferAttachmentMime(normalizedName, file.type || '');
  if (!attachmentMimeAllowed(type, mimeType) || (requestedType === 'gif' && mimeType !== 'image/gif')) {
    throw attachmentError('attachment-unsupported-type');
  }

  const extension = MIME_EXTENSIONS[mimeType];
  const stem = name.replace(/\.[^.]+$/, '').trim();
  const hasExtension = normalizedName.toLowerCase().endsWith(`.${extension}`);
  const fileName = hasExtension ? name : cleanFileName(`${stem || type}.${extension}`);
  return { type, mimeType, fileName, sizeBytes: file.size, caption: caption.trim() || null };
}

export function createChatAttachmentUploader({ sdk, mediaRef, currentUid, requireSession, documentId, call }) {
  const operations = new Map();

  function cancelUploads(nextUid) {
    for (const { uid, controller } of operations.values()) {
      if (nextUid !== uid) controller.abort();
    }
  }

  async function sendAttachment({ conversationId, file, type, caption = '', localId, replyTo = null, width, height, durationMs,
    onProgress = () => {}, signal }) {
    const uid = currentUid();
    const chatId = documentId(conversationId);
    if (typeof localId !== 'string' || !localId || localId.length > 128) throw attachmentError('local-id-required');
    const metadata = attachmentMetadata(file, type, caption);
    const dimensions = validMediaDimensions(width, height);
    const key = JSON.stringify([uid, chatId, localId]);
    if (operations.has(key)) throw attachmentError('attachment-upload-in-progress');

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    operations.set(key, { uid, controller });

    function requireActive() {
      if (controller.signal.aborted) throw new DOMException('Attachment upload cancelled', 'AbortError');
      requireSession(uid);
    }

    async function upload(ref) {
      requireActive();
      const task = sdk.uploadBytesResumable(ref, file, { contentType: metadata.mimeType });
      const cancel = () => task.cancel();
      controller.signal.addEventListener('abort', cancel, { once: true });
      const unsubscribe = task.on('state_changed', ({ bytesTransferred, totalBytes }) => {
        if (!controller.signal.aborted && totalBytes > 0) onProgress(Math.min(0.99, bytesTransferred / totalBytes));
      });
      try {
        await task;
        requireActive();
      } finally {
        unsubscribe();
        controller.signal.removeEventListener('abort', cancel);
      }
    }

    try {
      requireActive();
      onProgress(0);
      requireActive();
      const created = await call('createMediaMessage', {
        conversationId: chatId, ...metadata, ...dimensions, replyTo, localId,
        ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
      });
      requireActive();
      const messageId = documentId(created?.messageId);
      const path = created?.storagePath;
      if (typeof path !== 'string' || !path.startsWith(`chatMedia/${chatId}/${uid}/${messageId}/`)) {
        throw attachmentError('storage-path-invalid');
      }
      const ref = mediaRef(path);
      if (created.uploadStatus === 'uploaded') {
        onProgress(1);
        return created;
      }

      const finalize = () => call('finalizeMediaMessage', { conversationId: chatId, messageId });
      let result;
      if (created.idempotent) {
        // Storage accepts a new object only. A retry may need just the finalize call.
        result = await finalize().catch((error) => {
          if (error?.code !== 'functions/failed-precondition' || error?.message !== 'upload-missing') throw error;
          return null;
        });
        requireActive();
      }
      if (!result) {
        await upload(ref);
        requireActive();
        result = await finalize();
        requireActive();
      }
      onProgress(1);
      return result;
    } catch (error) {
      requireActive();
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      operations.delete(key);
    }
  }

  return { sendAttachment, cancelUploads };
}
