// Callable: return Message Info metadata for a message the caller can read.
//
// Phase 6 returned aggregate metadata only. Phase 7 extends it: when the
// caller is the message sender, the response includes a per-recipient
// receipt list (uid + displayName snapshot + role + status + per-status
// timestamps). Non-senders see the aggregate counts only and the client
// surfaces a permission notice.
//
// Phone numbers, emails, and other PII are never returned. The body of
// the message is never returned — the bubble already shows it.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

type Status = 'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed';

type Recipient = {
  uid:           string;
  displayName:   string | null;
  photoURL:      string | null;
  role:          'owner' | 'admin' | 'member' | null;
  status:        Status;
  deliveredAt:   unknown | null;
  readAt:        unknown | null;
  viewedAt:      unknown | null;
  playedAt:      unknown | null;
  failedAt:      unknown | null;
  failureReason: string | null;
};

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

  const convo = convoSnap.data() as { type?: string; participantUids?: string[]; memberIds?: string[] };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }
  const isGroup = convo.type === 'group';
  const msg = msgSnap.data() as Record<string, unknown>;
  const senderUid = (msg.senderUid as string | undefined) ?? (msg.senderId as string | undefined) ?? null;
  const isSender = senderUid === uid;

  let aggregates: Record<string, number> = {
    deliveredCount: (msg.deliveredCount as number) ?? 0,
    readCount:      (msg.readCount      as number) ?? 0,
    viewedCount:    (msg.viewedCount    as number) ?? 0,
    playedCount:    (msg.playedCount    as number) ?? 0,
    failedCount:    (msg.failedCount    as number) ?? 0,
    pendingCount:   (msg.pendingCount   as number) ?? 0,
  };

  let recipients: Recipient[] | null = null;

  if (isSender) {
    const receiptsSnap = await msgRef.collection('receipts').get();

    // Legacy fallback: if onReceiptWrite hasn't populated the denorm
    // fields yet, compute aggregates live from the receipts.
    if (receiptsSnap.size > 0 && !msg.receiptUpdatedAt) {
      const live: Record<string, number> = {
        deliveredCount: 0, readCount: 0, viewedCount: 0,
        playedCount: 0,    failedCount: 0, pendingCount: 0,
      };
      for (const d of receiptsSnap.docs) {
        const s = ((d.data() as { status?: string }).status ?? 'pending') as Status;
        switch (s) {
          case 'delivered': live.deliveredCount += 1; break;
          case 'read':      live.readCount      += 1; live.deliveredCount += 1; live.viewedCount += 1; break;
          case 'viewed':    live.viewedCount    += 1; live.deliveredCount += 1; break;
          case 'played':    live.playedCount    += 1; live.deliveredCount += 1; break;
          case 'failed':    live.failedCount    += 1; break;
          default:          live.pendingCount   += 1;
        }
      }
      aggregates = live;
    }

    const recipientUids = participants.filter(u => u !== uid);
    const memberSnapsP = isGroup
      ? Promise.all(recipientUids.map(u => convoRef.collection('members').doc(u).get()))
      : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]);
    const userSnapsP = !isGroup
      ? Promise.all(recipientUids.map(u => db.collection('users').doc(u).get()))
      : Promise.resolve([] as FirebaseFirestore.DocumentSnapshot[]);
    const [memberSnaps, userSnaps] = await Promise.all([memberSnapsP, userSnapsP]);

    const receiptsByUid = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const r of receiptsSnap.docs) receiptsByUid.set(r.id, r);

    recipients = recipientUids.map((u, i) => {
      let displayName: string | null = null;
      let photoURL:    string | null = null;
      let role:        Recipient['role'] = null;

      if (isGroup) {
        const m = memberSnaps[i]?.data() as { displayNameSnapshot?: string; photoURLSnapshot?: string | null; role?: Recipient['role'] } | undefined;
        displayName = m?.displayNameSnapshot ?? null;
        photoURL    = m?.photoURLSnapshot   ?? null;
        role        = m?.role ?? 'member';
      } else {
        const u2 = userSnaps[i]?.data() as { displayName?: string; photoURL?: string } | undefined;
        displayName = u2?.displayName ?? null;
        photoURL    = u2?.photoURL    ?? null;
      }

      const r = receiptsByUid.get(u)?.data() as Record<string, unknown> | undefined;
      const status = ((r?.status as string) ?? 'pending') as Status;

      return {
        uid: u,
        displayName,
        photoURL,
        role,
        status,
        deliveredAt:   r?.deliveredAt   ?? null,
        readAt:        r?.readAt        ?? null,
        viewedAt:      r?.viewedAt      ?? null,
        playedAt:      r?.playedAt      ?? null,
        failedAt:      r?.failedAt      ?? null,
        failureReason: (r?.failureReason as string | undefined) ?? null,
      };
    });
  }

  return {
    messageId:          data.messageId,
    conversationId:     data.conversationId,
    type:               msg.type ?? 'text',
    senderUid,
    senderDisplayName:  (msg.senderDisplayName as string | undefined) ?? null,
    createdAt:          msg.createdAt ?? null,
    editedAt:           msg.editedAt  ?? null,
    deletedForEveryone: msg.deletedForEveryone === true,
    deletedAt:          msg.deletedAt ?? null,
    pinnedAt:           msg.pinnedAt  ?? null,
    pinnedBy:           (msg.pinnedBy as string | undefined) ?? null,
    forwarded:          msg.forwarded === true,
    forwardedFrom:      msg.forwardedFrom ?? null,
    replyTo:            msg.replyTo ?? null,

    aggregates,
    isSender,
    isGroup,
    recipients,

    // back-compat fields for Phase 6 mobile clients.
    reactions:     msg.reactions ?? {},
    receiptCounts: aggregates,
  };
});
