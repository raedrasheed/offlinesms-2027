// Callable: toggle the caller's reaction on a message.
//
// One emoji per user per message. Toggling the same emoji clears it;
// choosing a different emoji replaces the previous one. Not audited
// (would be too noisy).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Conservative allow-list — extend as the product wants.
const ALLOWED_EMOJI = new Set(['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉']);

export const reactToMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; messageId?: unknown; emoji?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');
  if (typeof data.emoji !== 'string' || !ALLOWED_EMOJI.has(data.emoji))
    throw new HttpsError('invalid-argument', 'emoji-not-allowed');

  const emoji = data.emoji as string;

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

  const msg = msgSnap.data() as { deletedForEveryone?: boolean; reactions?: Record<string, string[]> };
  if (msg.deletedForEveryone) throw new HttpsError('failed-precondition', 'message-deleted');

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

  return { ok: true, emoji, toggledOff };
});
