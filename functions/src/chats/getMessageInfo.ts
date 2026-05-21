// Callable: return Message Info metadata for a message the caller can read.
//
// Full delivery/read analytics land in Phase 7. For now we return the
// fields the UI needs to render: sent/edited/deleted/pinned timestamps,
// reaction summary, reply / forwarded metadata, and a count of receipt
// placeholders by status (which the existing onMessageCreate trigger
// writes as 'pending' for each recipient).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

export const getMessageInfo = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; messageId?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const msgRef = convoRef.collection('messages').doc(data.messageId);

  const [convoSnap, msgSnap] = await Promise.all([convoRef.get(), msgRef.get()]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if (!msgSnap.exists)   throw new HttpsError('not-found', 'message-not-found');

  const convo = convoSnap.data() as { participantUids?: string[]; memberIds?: string[] };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  const msg = msgSnap.data() as Record<string, unknown>;

  // Aggregate receipt status counts.
  const receiptsSnap = await msgRef.collection('receipts').get();
  const receiptCounts: Record<string, number> = {};
  for (const r of receiptsSnap.docs) {
    const status = ((r.data() as { status?: string }).status ?? 'pending') as string;
    receiptCounts[status] = (receiptCounts[status] ?? 0) + 1;
  }

  // Reaction summary: emoji → count.
  const reactionsRaw = (msg.reactions ?? {}) as Record<string, string[]>;
  const reactionSummary: Record<string, number> = {};
  for (const [emoji, uids] of Object.entries(reactionsRaw)) {
    reactionSummary[emoji] = (uids ?? []).length;
  }

  return {
    messageId:          data.messageId,
    conversationId:     data.conversationId,
    type:               msg.type ?? 'text',
    senderUid:          msg.senderUid ?? msg.senderId ?? null,
    senderDisplayName:  msg.senderDisplayName ?? null,
    createdAt:          msg.createdAt ?? null,
    editedAt:           msg.editedAt ?? null,
    deletedForEveryone: msg.deletedForEveryone === true,
    deletedAt:          msg.deletedAt ?? null,
    pinnedAt:           msg.pinnedAt ?? null,
    pinnedBy:           msg.pinnedBy ?? null,
    forwarded:          msg.forwarded === true,
    forwardedFrom:      msg.forwardedFrom ?? null,
    replyTo:            msg.replyTo ?? null,
    reactions:          reactionSummary,
    receiptCounts,
  };
});
