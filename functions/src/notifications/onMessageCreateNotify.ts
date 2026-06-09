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

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import {
  buildNotification, decideForRecipient,
  type ChatType, type NotifSettings,
} from './notifyLogic';
import { sendPushToUser } from './send';

export const onMessageCreateNotify = onDocumentCreated(
  'conversations/{convoId}/messages/{msgId}',
  async (event) => {
    const db = getFirestore();
    const msg = event.data?.data();
    if (!msg) return;
    const { convoId, msgId } = event.params as { convoId: string; msgId: string };

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

    const senderName: string = msg.senderDisplayName ?? 'Someone';
    const groupName = convo.name ?? 'Group';

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
      });

      return sendPushToUser(uid, {
        title, body, silent: decision.silent, conversationId: convoId,
        data: {
          type: 'chat_message', conversationId: convoId, messageId: msgId,
          senderUid, chatType, route: 'Conversation',
        },
      });
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
  },
);
