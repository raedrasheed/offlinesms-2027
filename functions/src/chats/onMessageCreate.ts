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

function buildPreview(msg: { type?: string; text?: string; media?: {presentation?: string} }): string {
  // Phase 23 — media messages get human-readable previews (no caption/content).
  if (msg.type === 'image') return msg.media?.presentation === 'sticker' ? 'Sticker' : 'Photo';
  if (msg.type === 'voice') return 'Voice message';
  if (msg.type === 'file') return 'File';
  if (msg.type === 'clip') return 'Video clip';
  if (msg.type === 'video') return 'Video';
  if (msg.type === 'audio') return 'Audio';
  if (msg.type === 'location') return 'Location';
  if (msg.type === 'contact') return 'Contact';
  // Stickers / polls: their `text` is a short fallback ("👋" / "📊 question").
  if (msg.type === 'sticker') return `${typeof msg.text === 'string' ? msg.text + ' ' : ''}Sticker`;
  if ((msg.type === 'text' || msg.type === 'poll') && typeof msg.text === 'string') {
    const t = msg.text.replace(/\s+/g, ' ').trim();
    return t.length > PREVIEW_MAX ? t.slice(0, PREVIEW_MAX - 1) + '…' : t;
  }
  return `[${msg.type ?? 'message'}]`;
}

// A transaction stays bounded as the roster grows. Per-recipient journals are
// server-only (unlike receipts, which clients may update), and commit with the
// unread increment. A retried/interrupted trigger never increments twice.
export const FANOUT_PAGE_SIZE = 100;

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
    const preview = buildPreview(msg as { type?: string; text?: string });
    const createdAt = msg.createdAt ?? FieldValue.serverTimestamp();
    const createdMs = msg.createdAt?.toMillis?.() ?? 0;
    const usable = (live: FirebaseFirestore.DocumentSnapshot) => live.exists
      && live.get('retentionDeleting') !== true && live.get('fanoutApplied') !== true;

    const pageCount = await db.runTransaction(async tx => {
      const [convo, live, senderState] = await tx.getAll(
        convoRef, msgRef, convoRef.collection('userState').doc(senderUid),
      );
      if (!convo.exists || !usable(live)) return null;
      if (live.get('fanoutSummaryApplied') === true) return live.get('fanoutPageCount') as number;
      const roster: string[] = convo.get('participantUids') ?? convo.get('memberIds') ?? [];
      if (!roster.length) return null;
      const recipients = [...new Set(roster)].filter(uid => uid !== senderUid);
      const count = Math.ceil(recipients.length / FANOUT_PAGE_SIZE);
      if (createdMs >= (convo.get('lastMessageAt')?.toMillis?.() ?? 0)) tx.update(convoRef, {
        lastMessage: { messageId: msgId, senderUid, type: msg.type ?? 'text', preview, createdAt },
        lastMessageText: preview, lastMessageAt: createdAt, lastSenderId: senderUid,
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (createdMs >= (senderState.get('lastMessageAt')?.toMillis?.() ?? 0)) {
        tx.set(senderState.ref, { uid: senderUid, unreadCount: 0, lastReadAt: createdAt,
          lastMessagePreview: preview, lastMessageAt: createdAt,
          updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
      // Freeze the roster in small server-only documents. Retrying tomorrow
      // must not mark historical messages unread for members who joined today.
      for (let page = 0; page < count; page++) tx.set(msgRef.collection('fanoutPages').doc(String(page)), {
        uids: recipients.slice(page * FANOUT_PAGE_SIZE, (page + 1) * FANOUT_PAGE_SIZE),
      });
      tx.update(msgRef, { fanoutSummaryApplied: true, fanoutPageCount: count });
      return count;
    });
    if (pageCount === null) return;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const keepGoing = await db.runTransaction(async tx => {
        const [live, convo, savedPage] = await tx.getAll(
          msgRef, convoRef, msgRef.collection('fanoutPages').doc(String(pageIndex)),
        );
        if (!usable(live) || !convo.exists) return false;
        if (!savedPage.exists) throw new Error('fanout-page-missing');
        const page: string[] = savedPage.get('uids');
        const active = new Set<string>(convo.get('participantUids') ?? convo.get('memberIds') ?? []);
        const uids = page.filter(uid => active.has(uid));
        const refs = uids.flatMap(uid => [
          convoRef.collection('userState').doc(uid),
          msgRef.collection('receipts').doc(uid),
          msgRef.collection('fanoutDeliveries').doc(uid),
        ]);
        // One bounded BatchGet RPC rather than 300 simultaneous transactional
        // reads competing for sockets and locks during a large roster page.
        const snapshots = refs.length ? await tx.getAll(...refs) : [];
        const rows = uids.map((uid, index) => ({ uid, state: snapshots[index * 3],
          receipt: snapshots[index * 3 + 1], done: snapshots[index * 3 + 2] }));
        // All reads finish before writing. Completion and unread count share
        // this transaction, so retry after any page failure is idempotent.
        for (const { uid, state, receipt, done } of rows) {
          if (done.get('complete') === true) continue;
          const unread = createdMs > (state.get('lastReadAt')?.toMillis?.() ?? 0);
          const newer = createdMs >= (state.get('lastMessageAt')?.toMillis?.() ?? 0);
          tx.set(state.ref, { uid,
            ...(unread ? { unreadCount: FieldValue.increment(1) } : {}),
            ...(newer ? { lastMessagePreview: preview, lastMessageAt: createdAt } : {}),
            updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          // A delivered/read receipt may have arrived before the create trigger.
          if (!receipt.exists) tx.set(receipt.ref, { status: 'pending', createdAt: FieldValue.serverTimestamp() });
          tx.set(done.ref, { complete: true });
        }
        return true;
      });
      if (!keepGoing) return;
    }
    await db.runTransaction(async tx => {
      const live = await tx.get(msgRef);
      if (usable(live)) tx.update(msgRef, { fanoutApplied: true });
    });
  }
);
