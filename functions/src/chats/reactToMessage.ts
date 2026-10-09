// Callable: toggle the caller's reaction on a message.
//
// One emoji per user per message. Toggling the same emoji clears it;
// choosing a different emoji replaces the previous one. Not audited
// (would be too noisy).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { decideReactionForRecipient, buildReactionNotification, type ChatType, type NotifSettings } from '../notifications/notifyLogic';
import { sendPushToUser } from '../notifications/send';

import { isAllowedReactionEmoji } from './reactionEmoji';
export { isAllowedReactionEmoji } from './reactionEmoji';

export const reactToMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; messageId?: unknown; emoji?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');
  if (!isAllowedReactionEmoji(data.emoji))
    throw new HttpsError('invalid-argument', 'emoji-not-allowed');

  const emoji = data.emoji as string;
  const conversationId = data.conversationId as string;
  const messageId = data.messageId as string;

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const msgRef = convoRef.collection('messages').doc(data.messageId);

  const [convoSnap, msgSnap] = await Promise.all([convoRef.get(), msgRef.get()]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if (!msgSnap.exists)   throw new HttpsError('not-found', 'message-not-found');

  const convo = convoSnap.data() as { participantUids?: string[]; memberIds?: string[]; type?: string; name?: string };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  const msg = msgSnap.data() as { deletedForEveryone?: boolean; reactions?: Record<string, string[]>; senderUid?: string; senderId?: string };
  if (msg.deletedForEveryone) throw new HttpsError('failed-precondition', 'message-deleted');
  const authorUid = msg.senderUid ?? msg.senderId;

  const next: Record<string, string[]> = {};
  let toggledOff = false;
  for (const [e, uids] of Object.entries(msg.reactions ?? {})) {
    // Remove this user from every other emoji first (one-emoji-per-user).
    const cleaned = (uids ?? []).filter(u => u !== uid);
    if (cleaned.length > 0) next[e] = cleaned;
    if (e === emoji && (uids ?? []).includes(uid)) {
      toggledOff = true;
    }
  }
  if (!toggledOff) {
    next[emoji] = [...(next[emoji] ?? []), uid];
  }

  await msgRef.update({
    reactions: Object.keys(next).length === 0 ? null : next,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Notify the message author when someone ADDS a reaction (not on removal,
  // and never self-reactions). Fire-and-forget — never block the reaction.
  if (!toggledOff && authorUid && authorUid !== uid) {
    void (async () => {
      try {
        const [authorStateSnap, settingsSnap, actorSnap] = await Promise.all([
          convoRef.collection('userState').doc(authorUid).get(),
          db.collection('users').doc(authorUid).collection('notificationSettings').doc('current').get(),
          db.collection('users').doc(uid).get(),
        ]);
        const decision = decideReactionForRecipient(
          { uid: authorUid, muted: authorStateSnap.get('muted') === true, settings: (settingsSnap.data() ?? {}) as NotifSettings },
          authorUid, uid,
        );
        if (!decision.notify) return;
        const chatType: ChatType = convo.type === 'group' ? 'group' : 'direct';
        const { title, body } = buildReactionNotification({
          chatType, groupName: convo.name, actorName: (actorSnap.data()?.displayName as string) ?? 'Someone', emoji,
        });
        await sendPushToUser(authorUid, {
          title, body, silent: decision.silent, conversationId,
          data: {
            type: 'reaction', conversationId, messageId,
            senderUid: uid, chatType, route: 'Conversation',
          },
        });
      } catch { /* best-effort */ }
    })();
  }

  return { ok: true, emoji, toggledOff };
});

