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

/** Read a local file (file:// uri) into a Blob. Works for Expo/RN file uris. */
async function readLocalBlob(localUri: string): Promise<Blob> {
  const res = await fetch(localUri);
  return res.blob();
}

/** Upload a Blob to Storage with progress, returning the download URL. */
async function uploadBlob(
  blob: Blob, storagePath: string, contentType: string,
  onProgress: (fraction: number) => void,
): Promise<string> {
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
        // Read the file first so we have an authoritative byte size (the picker
        // does not always report fileSize, which would fail server validation).
        const blob = await readLocalBlob(payload.localUri);
        const sizeBytes = blob.size || payload.sizeBytes || 0;
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
        // 2. Upload the binary with progress.
        const downloadURL = await uploadBlob(
          blob, created.storagePath, payload.mimeType,
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
    case 'send_voice_message': {
      const localId: string | null = payload.localMessageId ?? null;
      try {
        const blob = await readLocalBlob(payload.localUri);
        const sizeBytes = blob.size || payload.sizeBytes || 0;
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
        const downloadURL = await uploadBlob(
          blob, created.storagePath, payload.mimeType,
          (f) => { if (localId) void messagesRepo.setMediaProgress(localId, f); },
        );
        await call('finalizeMediaMessage', {
          conversationId: payload.conversationId,
          messageId: created.messageId,
          downloadURL,
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
