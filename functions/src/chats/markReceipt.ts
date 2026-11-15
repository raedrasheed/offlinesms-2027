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
import { isBinaryAttachment } from './attachmentModel';

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

  const data = (request.data ?? {}) as {
    conversationId?: unknown; messageId?: unknown; status?: unknown; recipientUid?: unknown;
  };
  // An account can change while an SDK request is waiting for an ID token.
  if (data.recipientUid !== undefined && data.recipientUid !== uid)
    throw new HttpsError('permission-denied', 'account-changed');
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

  const result = await db.runTransaction(async (tx) => {
    const [convo, message, snap] = await tx.getAll(convoRef, msgRef, receiptRef);
    if (!convo.exists) throw new HttpsError('not-found', 'conversation-not-found');
    if (!message.exists) throw new HttpsError('not-found', 'message-not-found');
    const participants: string[] = convo.get('participantUids') ?? convo.get('memberIds') ?? [];
    if (!participants.includes(uid)) throw new HttpsError('permission-denied', 'not-a-participant');

    const senderUid = message.get('senderUid') ?? message.get('senderId');
    if (senderUid === uid) return { applied: false, reason: 'self-receipt' };
    if (message.get('retentionDeleting') === true) throw new HttpsError('not-found', 'message-expired');
    if (message.get('deletedForEveryone') === true) return { applied: false, reason: 'message-deleted' };
    const uploadStatus = message.get('media.uploadStatus');
    if (status !== 'failed' && isBinaryAttachment(message.get('type')) && uploadStatus != null && uploadStatus !== 'uploaded') {
      return { applied: false, reason: 'media-not-ready' };
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
    // A read, view or playback also proves delivery if its receipt arrived first.
    if (status !== 'failed' && !current?.['deliveredAt']) patch.deliveredAt = now;
    if (status === 'read'      && !current?.['readAt'])      patch.readAt      = now;
    if (status === 'viewed'    && !current?.['viewedAt'])    patch.viewedAt    = now;
    if (status === 'played'    && !current?.['playedAt'])    patch.playedAt    = now;
    if (status === 'failed')                                  patch.failedAt    = now;

    tx.set(receiptRef, patch, { merge: true });
    return { applied: true };
  });

  return { ok: true, ...result };
});
