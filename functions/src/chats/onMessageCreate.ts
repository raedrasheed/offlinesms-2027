// Fan-out trigger for new messages.
//
// Runs after any new message doc is created and is the single source of
// truth for keeping conversation + per-user state consistent:
//
//   1. Update the parent conversation's lastMessage object (Phase 4) and
//      the legacy lastMessageText / lastMessageAt / lastSenderId fields.
//   2. Bump every recipient's userState.unreadCount and refresh their
//      lastMessagePreview / lastMessageAt so the chat list reflects
//      the new traffic without any further client work.
//   3. Write per-recipient receipt placeholders (Phase 0 behaviour).
//
// Sender-side userState gets `lastReadAt = createdAt` and `unreadCount = 0`
// so a self-send never leaves the sender showing unread on their own chat.

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const PREVIEW_MAX = 80;

function buildPreview(msg: { type?: string; text?: string }): string {
  // Phase 23 — media messages get human-readable previews (no caption/content).
  if (msg.type === 'image') return 'Photo';
  if (msg.type === 'voice') return 'Voice message';
  // Stickers / polls: their `text` is a short fallback ("👋" / "📊 question").
  if (msg.type === 'sticker') return `${typeof msg.text === 'string' ? msg.text + ' ' : ''}Sticker`;
  if ((msg.type === 'text' || msg.type === 'poll') && typeof msg.text === 'string') {
    const t = msg.text.replace(/\s+/g, ' ').trim();
    return t.length > PREVIEW_MAX ? t.slice(0, PREVIEW_MAX - 1) + '…' : t;
  }
  return `[${msg.type ?? 'message'}]`;
}

export const onMessageCreate = onDocumentCreated(
  { document: 'conversations/{convoId}/messages/{msgId}', retry: true },
  async (event) => {
    const db = getFirestore();
    const msg = event.data?.data();
    if (!msg) return;
    const { convoId, msgId } = event.params as { convoId: string; msgId: string };

    const senderUid: string = msg.senderUid ?? msg.senderId;
    if (!senderUid) return;

    const convoRef = db.collection('conversations').doc(convoId);
    const msgRef = convoRef.collection('messages').doc(msgId);
    await db.runTransaction(async batch => {
      const [convoSnap, liveMessage, receipts, states] = await Promise.all([
        batch.get(convoRef), batch.get(msgRef), batch.get(msgRef.collection('receipts')), batch.get(convoRef.collection('userState')),
      ]);
      if (!convoSnap.exists || !liveMessage.exists || liveMessage.get('retentionDeleting') === true || liveMessage.get('fanoutApplied') === true) return;
      const convo = convoSnap.data() as {
        participantUids?: string[];
        memberIds?: string[];
      };

      const participants = convo.participantUids ?? convo.memberIds ?? [];
      if (participants.length === 0) return;
      const recipients = participants.filter(uid => uid !== senderUid);
      const preview = buildPreview(msg as { type?: string; text?: string });
      const createdAt = msg.createdAt ?? FieldValue.serverTimestamp();

      const stateByUid = new Map(states.docs.map(d => [d.id, d]));
      const receiptUids = new Set(receipts.docs.map(d => d.id));
      const createdMs = msg.createdAt?.toMillis?.() ?? 0;
      const newerSummary = createdMs >= (convoSnap.get('lastMessageAt')?.toMillis?.() ?? 0);

      // 1. Conversation summary — both new (lastMessage object) and legacy fields.
      if (newerSummary) batch.update(convoRef, {
        lastMessage: {
          messageId: msgId,
          senderUid,
          type:      msg.type ?? 'text',
          preview,
          createdAt,
        },
        lastMessageText: preview,
        lastMessageAt:   createdAt,
        lastSenderId:    senderUid,
        updatedAt:       FieldValue.serverTimestamp(),
      });

      // 2. Sender userState — cleared.
      const senderStateRef = convoRef.collection('userState').doc(senderUid);
      if (createdMs >= (stateByUid.get(senderUid)?.get('lastMessageAt')?.toMillis?.() ?? 0)) batch.set(senderStateRef, {
        uid:                senderUid,
        unreadCount:        0,
        lastReadAt:         createdAt,
        lastMessagePreview: preview,
        lastMessageAt:      createdAt,
        updatedAt:          FieldValue.serverTimestamp(),
      }, { merge: true });

      // 3. Recipient userState — increment unread + refresh preview.
      for (const uid of recipients) {
        const stateRef = convoRef.collection('userState').doc(uid);
        const state = stateByUid.get(uid);
        const unread = createdMs > (state?.get('lastReadAt')?.toMillis?.() ?? 0);
        const newer = createdMs >= (state?.get('lastMessageAt')?.toMillis?.() ?? 0);
        batch.set(stateRef, {
          uid,
          ...(unread ? { unreadCount: FieldValue.increment(1) } : {}),
          ...(newer ? { lastMessagePreview: preview, lastMessageAt: createdAt } : {}),
          updatedAt:          FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      // 4. Pending receipts for each recipient (Phase 0 + Phase 3 enum gate).
      for (const uid of recipients) {
        const ref = convoRef.collection('messages').doc(msgId).collection('receipts').doc(uid);
        if (!receiptUids.has(uid)) batch.set(ref, { status: 'pending', createdAt: FieldValue.serverTimestamp() });
      }

      batch.update(msgRef, { fanoutApplied: true });
    });
  }
);
