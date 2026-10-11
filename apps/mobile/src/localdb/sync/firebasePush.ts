// Phase 22 — push: map outbox items to existing Cloud Function callables.
//
// IMPORTANT: privileged/business operations always go through their callable
// (never a raw Firestore write), so server-side permission, audit, points, and
// SMS logic stay authoritative. send_message passes localId + idempotencyKey so
// the server can dedupe retries (see functions/src/chats/sendTextMessage.ts).

import { getFunctions, httpsCallable } from 'firebase/functions';
import * as FileSystem from 'expo-file-system';
import { app, auth } from '../../lib/firebase';
import * as messagesRepo from '../repositories/messagesRepo';
import { setTransferProgress, clearTransfer } from '../../media/transferProgress';
import { emitLocalMessagesChanged } from '../messageChanges';
import type { OutboxRow } from '../types';

export interface PushResult {
  ok: boolean;
  remoteId?: string;       // canonical message id for reconciliation
  idempotent?: boolean;    // server recognised a duplicate
}

function call<T = any>(name: string, data: any): Promise<T> {
  return httpsCallable<any, T>(getFunctions(app), name)(data).then(r => r.data);
}

/** Normalize an upload/finalize failure into a recordable {code, message} and
 *  log it. Firebase StorageError carries a `.code` like 'storage/unauthorized'
 *  or 'storage/unknown' (a wrong storageBucket surfaces here), which is the
 *  fastest way to tell a config error apart from a transient network drop. */
function mediaError(err: unknown): { code: string | null; message: string | null } {
  const e = err as { code?: string; message?: string } | null;
  const code = typeof e?.code === 'string' ? e.code : null;
  const message = typeof e?.message === 'string' ? e.message : String(err);
  console.warn(`[media upload failed] code=${code ?? 'unknown'} message=${message}`);
  return { code, message };
}

/** Byte size of a local file, or 0 if it can't be read. */
async function localFileSize(localUri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(localUri);
    return info.exists && !info.isDirectory ? info.size : 0;
  } catch { return 0; }
}

/**
 * Upload a local file to Storage via the native HTTP stack (expo-file-system),
 * not the Firebase JS SDK. uploadBytes/uploadBytesResumable stall at 0% under
 * Hermes in RN release builds; a native binary POST to Storage's REST upload
 * endpoint transfers reliably and still reports progress. Returns the tokenized
 * download URL (same shape getDownloadURL would produce).
 */
async function uploadLocalFile(
  localUri: string, storagePath: string, contentType: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw Object.assign(new Error('not-authenticated'), { code: 'storage/unauthenticated' });
  const bucket = app.options.storageBucket;
  if (!bucket) throw Object.assign(new Error('no-storage-bucket'), { code: 'storage/no-bucket' });

  const name = encodeURIComponent(storagePath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${name}`;
  const uploadTask = FileSystem.createUploadTask(
    url, localUri,
    {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: `Firebase ${token}`, 'Content-Type': contentType },
    },
    (p) => { if (p.totalBytesExpectedToSend > 0) onProgress(p.totalBytesSent / p.totalBytesExpectedToSend); },
  );
  const res = await uploadTask.uploadAsync();
  if (!res || res.status < 200 || res.status >= 300) {
    throw Object.assign(new Error(`upload-http-${res?.status ?? 'no-response'}`), {
      code: `storage/http-${res?.status ?? 0}`, message: (res?.body ?? '').slice(0, 300),
    });
  }
  let downloadToken = '';
  try { downloadToken = String(JSON.parse(res.body).downloadTokens ?? '').split(',')[0]; } catch { /* metadata parse best-effort */ }
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${name}?alt=media${downloadToken ? `&token=${downloadToken}` : ''}`;
}

export async function pushOutboxItem(item: OutboxRow): Promise<PushResult> {
  const payload = JSON.parse(item.payload_json || '{}');

  switch (item.type) {
    case 'send_message': {
      const res = await call<{ messageId: string; idempotent?: boolean }>('sendTextMessage', {
        conversationId: payload.conversationId,
        // Only the new backend may create the text fallback for rich messages.
        // Omitting it makes an older backend refuse instead of losing the options.
        ...(payload.kind === 'poll' || payload.kind === 'sticker' ? {} : { text: payload.text }),
        replyTo: payload.replyTo ?? null,
        mentions: payload.mentions ?? null,
        localId: payload.localId,
        idempotencyKey: item.idempotency_key,
        clientCreatedAt: payload.clientCreatedAt ?? null,
        ...(payload.kind ? { kind: payload.kind, sticker: payload.sticker ?? null, poll: payload.poll ?? null } : {}),
      });
      return { ok: true, remoteId: res?.messageId, idempotent: res?.idempotent };
    }
    case 'send_image_message': {
      const localId: string | null = payload.localMessageId ?? null;
      try {
        // Authoritative byte size from the file (the picker does not always
        // report fileSize, which would fail server validation).
        const sizeBytes = await localFileSize(payload.localUri) || payload.sizeBytes || 0;
        // 1. Reserve the message doc + Storage path (idempotent by localId).
        const created = await call<{ messageId: string; storagePath: string; idempotent?: boolean }>('createMediaMessage', {
          conversationId: payload.conversationId,
          type: 'image',
          caption: payload.caption ?? null,
          mimeType: payload.mimeType,
          sizeBytes,
          width: payload.width ?? null,
          height: payload.height ?? null,
          replyTo: payload.replyTo ?? null,
          localId,
          idempotencyKey: item.idempotency_key,
        });
        // Reconcile the local row to the server id immediately so the realtime
        // feeder (which sees the new doc during the slow upload) updates this
        // row instead of inserting a duplicate / colliding on remote_id.
        if (localId) { try { await messagesRepo.reconcileToRemote(localId, { remoteId: created.messageId, remoteCreatedAt: null }); } catch { /* noop */ } }
        // 2. Upload the binary with live progress (keyed by the message id the
        //    bubble renders, so the % counter increments).
        const downloadURL = await uploadLocalFile(
          payload.localUri, created.storagePath, payload.mimeType,
          (f) => { setTransferProgress(created.messageId, 'upload', f); if (localId) void messagesRepo.setMediaProgress(localId, f); },
        );
        // 3. Finalize (idempotent).
        await call('finalizeMediaMessage', {
          conversationId: payload.conversationId,
          messageId: created.messageId,
          downloadURL,
          width: payload.width ?? null,
          height: payload.height ?? null,
          sizeBytes: payload.sizeBytes,
        });
        if (localId) await messagesRepo.setMediaUploaded(localId, { downloadURL });
        clearTransfer(created.messageId);
        return { ok: true, remoteId: created.messageId, idempotent: created.idempotent };
      } catch (err) {
        if (localId) await messagesRepo.setMediaFailed(localId, mediaError(err)).catch(() => {});
        throw err;
      }
    }
    case 'send_voice_message': {
      const localId: string | null = payload.localMessageId ?? null;
      try {
        const sizeBytes = await localFileSize(payload.localUri) || payload.sizeBytes || 0;
        const created = await call<{ messageId: string; storagePath: string; idempotent?: boolean }>('createMediaMessage', {
          conversationId: payload.conversationId,
          type: 'voice',
          mimeType: payload.mimeType,
          sizeBytes,
          durationMs: payload.durationMs,
          waveform: payload.waveform ?? null,
          replyTo: payload.replyTo ?? null,
          localId,
          idempotencyKey: item.idempotency_key,
        });
        if (localId) { try { await messagesRepo.reconcileToRemote(localId, { remoteId: created.messageId, remoteCreatedAt: null }); } catch { /* noop */ } }
        const downloadURL = await uploadLocalFile(
          payload.localUri, created.storagePath, payload.mimeType,
          (f) => { setTransferProgress(created.messageId, 'upload', f); if (localId) void messagesRepo.setMediaProgress(localId, f); },
        );
        await call('finalizeMediaMessage', {
          conversationId: payload.conversationId,
          messageId: created.messageId,
          downloadURL,
          sizeBytes: payload.sizeBytes,
        });
        if (localId) await messagesRepo.setMediaUploaded(localId, { downloadURL });
        clearTransfer(created.messageId);
        return { ok: true, remoteId: created.messageId, idempotent: created.idempotent };
      } catch (err) {
        if (localId) await messagesRepo.setMediaFailed(localId, mediaError(err)).catch(() => {});
        throw err;
      }
    }
    case 'vote_poll':
      await call('votePoll', { conversationId: payload.conversationId, messageId: payload.messageId, optionIds: payload.optionIds, seq: payload.seq });
      return { ok: true };
    case 'close_poll':
      await call('closePoll', { conversationId: payload.conversationId, messageId: payload.messageId });
      await messagesRepo.confirmPollClosed(payload.messageId);
      emitLocalMessagesChanged(payload.conversationId);
      return { ok: true };
    case 'edit_message':
      await call('editMessage', { conversationId: payload.conversationId, messageId: payload.messageId, text: payload.text });
      return { ok: true };
    case 'delete_message':
      await call('deleteMessage', { conversationId: payload.conversationId, messageId: payload.messageId, mode: payload.mode });
      return { ok: true };
    case 'react_message':
      await call('reactToMessage', { conversationId: payload.conversationId, messageId: payload.messageId, emoji: payload.emoji });
      return { ok: true };
    case 'star_message':
      await call('starMessage', { conversationId: payload.conversationId, messageId: payload.messageId, starred: payload.starred });
      return { ok: true };
    case 'pin_message':
      await call('pinMessage', { conversationId: payload.conversationId, messageId: payload.messageId, pinned: payload.pinned });
      return { ok: true };
    case 'mark_receipt':
      await call('markReceipt', payload);
      return { ok: true };
    case 'create_group':
      await call('createGroup', payload);
      return { ok: true };
    case 'group_action':
      await call(payload.action, payload.args ?? {});
      return { ok: true };
    case 'sms_escalation':
      await call('escalateSms', payload);
      return { ok: true };
    case 'support_ticket':
      await call('createSupportTicket', payload);
      return { ok: true };
    case 'create_phone_contact':
      await call('createPhoneContact', payload);
      return { ok: true };
    case 'add_external_contact_to_group':
      await call('addExternalContactToGroup', payload);
      return { ok: true };
    case 'remove_external_contact_from_group':
      await call('removeExternalContactFromGroup', payload);
      return { ok: true };
    default:
      throw Object.assign(new Error(`unknown outbox type: ${item.type}`), { code: 'functions/invalid-argument' });
  }
}

