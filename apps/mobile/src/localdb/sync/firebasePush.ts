// Phase 22 — push: map outbox items to existing Cloud Function callables.
//
// IMPORTANT: privileged/business operations always go through their callable
// (never a raw Firestore write), so server-side permission, audit, points, and
// SMS logic stay authoritative. send_message passes localId + idempotencyKey so
// the server can dedupe retries (see functions/src/chats/sendTextMessage.ts).

import { getFunctions, httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { app, storage } from '../../lib/firebase';
import * as messagesRepo from '../repositories/messagesRepo';
import type { OutboxRow } from '../types';

export interface PushResult {
  ok: boolean;
  remoteId?: string;       // canonical message id for reconciliation
  idempotent?: boolean;    // server recognised a duplicate
}

function call<T = any>(name: string, data: any): Promise<T> {
  return httpsCallable<any, T>(getFunctions(app), name)(data).then(r => r.data);
}

/**
 * Upload a local file to Storage with progress, returning the download URL.
 * `fetch(localUri).blob()` reads file:// URIs in Expo/RN. Re-uploading to the
 * same path on retry is safe (it overwrites the same object).
 */
async function uploadLocalFile(
  localUri: string, storagePath: string, contentType: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const res = await fetch(localUri);
  const blob = await res.blob();
  const task = uploadBytesResumable(ref(storage, storagePath), blob, { contentType });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed',
      (snap) => { if (snap.totalBytes > 0) onProgress(snap.bytesTransferred / snap.totalBytes); },
      reject,
      () => resolve(),
    );
  });
  return getDownloadURL(task.snapshot.ref);
}

export async function pushOutboxItem(item: OutboxRow): Promise<PushResult> {
  const payload = JSON.parse(item.payload_json || '{}');

  switch (item.type) {
    case 'send_message': {
      const res = await call<{ messageId: string; idempotent?: boolean }>('sendTextMessage', {
        conversationId: payload.conversationId,
        text: payload.text,
        replyTo: payload.replyTo ?? null,
        localId: payload.localId,
        idempotencyKey: item.idempotency_key,
        clientCreatedAt: payload.clientCreatedAt ?? null,
      });
      return { ok: true, remoteId: res?.messageId, idempotent: res?.idempotent };
    }
    case 'send_image_message': {
      const localId: string | null = payload.localMessageId ?? null;
      try {
        // 1. Reserve the message doc + Storage path (idempotent by localId).
        const created = await call<{ messageId: string; storagePath: string; idempotent?: boolean }>('createMediaMessage', {
          conversationId: payload.conversationId,
          type: 'image',
          caption: payload.caption ?? null,
          mimeType: payload.mimeType,
          sizeBytes: payload.sizeBytes,
          width: payload.width ?? null,
          height: payload.height ?? null,
          replyTo: payload.replyTo ?? null,
          localId,
          idempotencyKey: item.idempotency_key,
        });
        // 2. Upload the binary with progress.
        const downloadURL = await uploadLocalFile(
          payload.localUri, created.storagePath, payload.mimeType,
          (f) => { if (localId) void messagesRepo.setMediaProgress(localId, f); },
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
        return { ok: true, remoteId: created.messageId, idempotent: created.idempotent };
      } catch (err) {
        if (localId) await messagesRepo.setMediaFailed(localId).catch(() => {});
        throw err;
      }
    }
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
    default:
      throw Object.assign(new Error(`unknown outbox type: ${item.type}`), { code: 'functions/invalid-argument' });
  }
}
