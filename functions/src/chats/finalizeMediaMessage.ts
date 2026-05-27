// Callable: finalize a media message after its binary has been uploaded.
//
// Phase 23 — sender-only. Flips media.uploadStatus to 'uploaded' and records the
// optional download URLs + final metadata. Idempotent: re-running on an already
// finalized message is a no-op success (covers retry after a finalize that
// succeeded server-side but whose response was lost). Audit metadata only.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

export const finalizeMediaMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    conversationId?: unknown; messageId?: unknown;
    downloadURL?: unknown; thumbnailURL?: unknown;
    width?: unknown; height?: unknown; sizeBytes?: unknown;
  };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  if (typeof data.messageId !== 'string' || !data.messageId) {
    throw new HttpsError('invalid-argument', 'messageId-required');
  }

  const db = getFirestore();
  const msgRef = db.collection('conversations').doc(data.conversationId)
    .collection('messages').doc(data.messageId);
  const snap = await msgRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'message-not-found');
  const msg = snap.data() as {
    senderUid?: string; senderId?: string; type?: string;
    media?: { uploadStatus?: string };
  };
  const senderUid = msg.senderUid ?? msg.senderId;
  if (senderUid !== uid) throw new HttpsError('permission-denied', 'not-the-sender');
  if (msg.type !== 'image' && msg.type !== 'voice') {
    throw new HttpsError('failed-precondition', 'not-a-media-message');
  }

  // Idempotent: already uploaded → return as-is.
  if (msg.media?.uploadStatus === 'uploaded') {
    return { messageId: msgRef.id, idempotent: true };
  }

  const patch: Record<string, unknown> = {
    'media.uploadStatus': 'uploaded',
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (typeof data.downloadURL === 'string') patch['media.downloadURL'] = data.downloadURL;
  if (typeof data.thumbnailURL === 'string') patch['media.thumbnailURL'] = data.thumbnailURL;
  if (typeof data.width === 'number') patch['media.width'] = data.width;
  if (typeof data.height === 'number') patch['media.height'] = data.height;
  if (typeof data.sizeBytes === 'number') patch['media.sizeBytes'] = data.sizeBytes;

  await msgRef.update(patch);

  await writeAuditLog({
    action: 'chat.media.finalized',
    actor:  { uid },
    target: { type: 'message', id: msgRef.id },
    result: 'success',
    metadata: { conversationId: data.conversationId, mediaType: msg.type },
  });

  return { messageId: msgRef.id, idempotent: false };
});
