// Callable: mark the caller's receipt on a message.
//
// Status transitions are server-enforced monotonic:
//
//   pending → delivered → read   (read implies viewed for text)
//   pending → viewed
//   pending → played
//   *       → failed              (any → failed, server-side)
//
// Downgrade attempts (e.g. a stale 'delivered' arriving after 'read') are
// silently no-op'd. Self-receipts are rejected — only non-senders can
// mark a message they received.
//
// Not audited: receipt writes are too noisy for the audit log.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

type Status = 'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed';
const ALLOWED: ReadonlySet<Status> = new Set([
  'delivered', 'read', 'viewed', 'played', 'failed',
]);

// Ordered terminal-ish ranking. Higher = more "advanced" for read-style
// progress; 'failed' is special and replaces any other state.
const ORDER: Record<Status, number> = {
  pending:   0,
  delivered: 1,
  viewed:    2,
  read:      3,
  played:    3,
  failed:    99,
};

export const markReceipt = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; messageId?: unknown; status?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');
  if (typeof data.status !== 'string' || !ALLOWED.has(data.status as Status))
    throw new HttpsError('invalid-argument', 'status-invalid');

  const status = data.status as Status;

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const msgRef = convoRef.collection('messages').doc(data.messageId);
  const receiptRef = msgRef.collection('receipts').doc(uid);

  const [convoSnap, msgSnap] = await Promise.all([convoRef.get(), msgRef.get()]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if (!msgSnap.exists)   throw new HttpsError('not-found', 'message-not-found');

  const convo = convoSnap.data() as { participantUids?: string[]; memberIds?: string[] };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  const msg = msgSnap.data() as { senderUid?: string; senderId?: string };
  const senderUid = msg.senderUid ?? msg.senderId;
  if (senderUid === uid) {
    // Self-receipt isn't useful — sender already saw their own message.
    // Treat as a no-op (idempotent).
    return { ok: true, applied: false, reason: 'self-receipt' };
  }

  const result = await db.runTransaction(async (tx) => {
    const [liveMessage, snap] = await Promise.all([tx.get(msgRef), tx.get(receiptRef)]);
    if (!liveMessage.exists || liveMessage.get('retentionDeleting') === true) {
      throw new HttpsError('not-found', 'message-expired');
    }
    const current = snap.exists ? (snap.data() as Record<string, unknown>) : null;
    const currentStatus = ((current?.status as Status | undefined) ?? 'pending') as Status;

    // Monotonic-or-failed transition guard.
    if (status !== 'failed' && ORDER[status] <= ORDER[currentStatus]) {
      return { applied: false, reason: 'no-downgrade' };
    }

    const now = FieldValue.serverTimestamp();
    const patch: Record<string, unknown> = {
      uid,
      conversationId: data.conversationId,
      messageId:      data.messageId,
      status,
      updatedAt:      now,
    };
    if (!snap.exists) patch.createdAt = now;
    if (status === 'delivered' && !current?.['deliveredAt']) patch.deliveredAt = now;
    if (status === 'read'      && !current?.['readAt'])      patch.readAt      = now;
    if (status === 'viewed'    && !current?.['viewedAt'])    patch.viewedAt    = now;
    if (status === 'played'    && !current?.['playedAt'])    patch.playedAt    = now;
    if (status === 'failed')                                  patch.failedAt    = now;

    // `read` implies the recipient already received delivery — backfill
    // deliveredAt if missing so the per-recipient timeline stays sensible.
    if (status === 'read' && !current?.['deliveredAt']) {
      patch.deliveredAt = now;
    }

    tx.set(receiptRef, patch, { merge: true });
    return { applied: true };
  });

  return { ok: true, ...result };
});
