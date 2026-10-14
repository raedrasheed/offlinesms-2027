// Push-notification fan-out (Phase 27).
//
// A SEPARATE message-create trigger from onMessageCreate (which owns unread /
// summary state). Kept separate so notification work never blocks or
// complicates the consistency fan-out. Fire-and-forget by nature: a Firestore
// trigger runs async after the message is committed.
//
// For each recipient (excluding the sender) it reads their mute state
// (userState.muted), notification settings, and registered devices, builds a
// per-recipient title/body (honouring showPreview), sends via FCM multicast,
// and purges dead tokens.
//
// Active-chat suppression for a FOREGROUND viewer is handled client-side (the
// app drops the local banner when viewing that chat); the OS still delivers to
// background/killed apps, which is the expected WhatsApp behaviour.

import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  buildNotification, decideForRecipient, notifLang,
  type ChatType, type NotifSettings,
} from './notifyLogic';
import { cleanNameSnapshot, publicNameFrom } from '../lib/displayName';
import { sendPushToUser } from './send';

/** Media is announced only when opening the notification can fetch its file. */
export function notificationReady(msg: Record<string, any> | undefined): boolean {
  if (!msg || msg.deletedForEveryone || msg.retentionDeleting) return false;
  return msg.type !== 'image' && msg.type !== 'voice'
    || msg.media?.uploadStatus === 'uploaded' && !!msg.media?.downloadURL;
}

const messagePath = 'conversations/{convoId}/messages/{msgId}';
export const onMessageCreateNotify = onDocumentCreated({ document: messagePath, retry: true }, async event => {
  const msg = event.data?.data();
  if (notificationReady(msg)) await notifyMessage(event.params.convoId, event.params.msgId, msg!);
});
export const onMessageMediaReadyNotify = onDocumentUpdated({ document: messagePath, retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (['image', 'voice'].includes(after?.type) && !notificationReady(before) && notificationReady(after)) {
    await notifyMessage(event.params.convoId, event.params.msgId, after!);
  }
});

async function notifyMessage(convoId: string, msgId: string, msg: Record<string, any>): Promise<void> {
    const db = getFirestore();
    const senderUid: string = msg.senderUid ?? msg.senderId;
    if (!senderUid) return;
    if (msg.deletedForEveryone) return;

    const convoRef = db.collection('conversations').doc(convoId);
    const convoSnap = await convoRef.get();
    if (!convoSnap.exists) return;
    const convo = convoSnap.data() as { type?: string; name?: string; participantUids?: string[]; memberIds?: string[] };

    const chatType: ChatType = convo.type === 'group' ? 'group' : 'direct';
    const participants = convo.participantUids ?? convo.memberIds ?? [];
    const recipients = participants.filter(uid => uid !== senderUid);
    if (recipients.length === 0) return;

    // Sender name for BOTH direct and group chats comes from the sender's live
    // public profile (direct messages carry no name snapshot, so every direct
    // push used to say "Someone"). The message/member snapshot is only a
    // fallback; a uid is never shown. With no name at all, buildNotification
    // uses the recipient-language "Someone". Recipient docs are read in the
    // same batched getAll to pick each person's preferredLanguage.
    const userRefs = [senderUid, ...recipients].map(u => db.collection('users').doc(u));
    const userSnaps = await db.getAll(...userRefs).catch(() => [] as FirebaseFirestore.DocumentSnapshot[]);
    const senderDoc = userSnaps[0]?.data();
    const senderName: string | null =
      publicNameFrom(senderDoc, senderUid) ?? cleanNameSnapshot(msg.senderDisplayName, senderUid);
    const langOf = new Map<string, unknown>();
    userSnaps.slice(1).forEach((s, i) => langOf.set(recipients[i], s?.get('preferredLanguage')));
    const groupName = convo.name ?? null;

    // Resolve per-recipient: mute (userState) + settings, then send.
    const counts = await Promise.all(recipients.map(async (uid) => {
      const [stateSnap, settingsSnap] = await Promise.all([
        convoRef.collection('userState').doc(uid).get(),
        db.collection('users').doc(uid).collection('notificationSettings').doc('current').get(),
      ]);
      const muted = stateSnap.get('muted') === true;
      const settings = (settingsSnap.data() ?? {}) as NotifSettings;

      const decision = decideForRecipient({ uid, muted, settings }, chatType, senderUid);
      if (!decision.notify) return 0;

      const { title, body } = buildNotification({
        chatType, groupName, senderName, msg: msg as any, showPreview: settings.showPreview !== false,
        lang: notifLang(langOf.get(uid)),
      });

      // Per-recipient completion survives duplicate trigger deliveries. A lease
      // recovers a worker crash; transport acknowledgement is not exactly-once.
      const messageRef = convoRef.collection('messages').doc(msgId);
      const dispatchRef = messageRef.collection('notificationDeliveries').doc(uid);
      const claimed = await db.runTransaction(async tx => {
        const [live, prior] = await Promise.all([tx.get(messageRef), tx.get(dispatchRef)]);
        if (!live.exists || !notificationReady(live.data()) || prior.get('complete') === true) return false;
        if ((prior.get('leaseUntil') ?? 0) > Date.now()) throw new Error('notification-dispatch-in-progress');
        tx.set(dispatchRef, { leaseUntil: Date.now() + 120_000 }, { merge: true });
        return true;
      });
      if (!claimed) return 0;
      const sent = await sendPushToUser(uid, {
        title, body, silent: decision.silent, conversationId: convoId,
        data: {
          type: 'chat_message', conversationId: convoId, messageId: msgId,
          senderUid, chatType, route: 'Conversation',
          createdAtMs: String(msg.createdAt?.toMillis?.() ?? ''),
        },
      });
      await db.runTransaction(async tx => {
        const live = await tx.get(messageRef);
        if (!live.exists || live.get('retentionDeleting') === true) return;
        tx.set(dispatchRef, { complete: true, leaseUntil: 0, completedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      return sent;
    }));

    const sent = counts.reduce((a, b) => a + b, 0);
    // Lightweight delivery log (best-effort).
    if (sent > 0) {
      try {
        await db.collection('notificationLogs').add({
          conversationId: convoId, messageId: msgId, senderUid, recipients: recipients.length,
          sent, createdAt: FieldValue.serverTimestamp(),
        });
      } catch { /* noop */ }
    }
}
