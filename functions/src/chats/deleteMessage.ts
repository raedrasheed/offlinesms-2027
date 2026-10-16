// Callable: delete a message.
//
//   mode='for_me'        → append the message id to the caller's
//                          userState.deletedForMeMessageIds list (FIFO,
//                          capped at 500). No global mutation.
//   mode='for_everyone'  → sender, or a group owner/admin removing
//                          another member's message. Clears the body
//                          and flips deletedForEveryone=true.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ownedMediaPrefix } from './messageRetentionPolicy';
import { writeAuditLog } from '../lib/auditLog';

const HIDE_CAP = 500;

export const deleteMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; messageId?: unknown; mode?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');
  if (data.mode !== 'for_me' && data.mode !== 'for_everyone')
    throw new HttpsError('invalid-argument', 'mode-invalid');
  const mode = data.mode as 'for_me' | 'for_everyone';

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);
  const msgRef = convoRef.collection('messages').doc(data.messageId);

  const [convoSnap, msgSnap] = await Promise.all([convoRef.get(), msgRef.get()]);
  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  if (!msgSnap.exists)   throw new HttpsError('not-found', 'message-not-found');

  const convo = convoSnap.data() as {
    type?: string;
    participantUids?: string[];
    memberIds?: string[];
    lastMessage?: { messageId?: string };
    pinnedMessage?: { messageId?: string } | null;
  };
  const participants = convo.participantUids ?? convo.memberIds ?? [];
  if (!participants.includes(uid)) {
    throw new HttpsError('permission-denied', 'not-a-participant');
  }

  // ── for_me ────────────────────────────────────────────────────
  if (mode === 'for_me') {
    const stateRef = convoRef.collection('userState').doc(uid);
    const stateSnap = await stateRef.get();
    const existing = (stateSnap.data()?.deletedForMeMessageIds ?? []) as string[];
    if (!existing.includes(data.messageId)) {
      const next = [...existing, data.messageId];
      if (next.length > HIDE_CAP) next.splice(0, next.length - HIDE_CAP);
      await stateRef.set({
        uid,
        deletedForMeMessageIds: next,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    await writeAuditLog({
      action: 'message.deleted.for_me',
      actor:  { uid },
      target: { type: 'message', id: data.messageId },
      result: 'success',
      metadata: { conversationId: data.conversationId, messageId: data.messageId },
    });
    return { ok: true };
  }

  // ── for_everyone ──────────────────────────────────────────────
  const msg = msgSnap.data() as { senderUid?: string; senderId?: string; deletedForEveryone?: boolean };
  const storagePrefix = ownedMediaPrefix(msgRef.path, msgSnap.data()!);
  const senderUid = msg.senderUid ?? msg.senderId;

  let byRole: 'sender' | 'owner' | 'admin' = 'sender';
  if (senderUid !== uid) {
    // Group owner / admin may delete other members' messages.
    if (convo.type !== 'group') {
      throw new HttpsError('permission-denied', 'not-message-sender');
    }
    const memberSnap = await convoRef.collection('members').doc(uid).get();
    const role = (memberSnap.data()?.role ?? '') as string;
    if ((memberSnap.data()?.status ?? 'active') !== 'active' || (role !== 'owner' && role !== 'admin')) {
      throw new HttpsError('permission-denied', 'admins-only');
    }
    byRole = role as 'owner' | 'admin';
  }

  if (msg.deletedForEveryone) {
    if (storagePrefix) await getStorage().bucket().deleteFiles({prefix:storagePrefix});
    return {ok:true};
  }

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.update(msgRef, {
    text:               '',
    deletedForEveryone: true,
    deletedAt:          now,
    deletedBy:          uid,
    deleteReason:       null,
    updatedAt:          now,
    editedAt:           null,
    replyTo:            null,
    // Reactions stay or are dropped? Drop — they reference a now-empty message.
    reactions:          null,
    // A deleted poll/sticker keeps nothing (votes would otherwise stay readable).
    poll:               FieldValue.delete(),
    sticker:            FieldValue.delete(),
    contact:            FieldValue.delete(),
    location:           FieldValue.delete(),
    caption:            FieldValue.delete(),
    media:              FieldValue.delete(),
  });

  // Refresh conversation summary if this was the latest message.
  if (convo.lastMessage?.messageId === data.messageId) {
    batch.update(convoRef, {
      lastMessage: {
        ...(convo.lastMessage as object),
        preview: '[deleted]',
      },
      lastMessageText: '[deleted]',
      updatedAt:       now,
    });
  }
  // Clear conversation pin if it pointed at this message.
  if (convo.pinnedMessage?.messageId === data.messageId) {
    batch.update(convoRef, { pinnedMessage: null, updatedAt: now });
  }

  await batch.commit();
  // Retried calls also clean up this exact message-owned prefix. Forwarded
  // copies have different prefixes and remain valid.
  if (storagePrefix) await getStorage().bucket().deleteFiles({prefix:storagePrefix});

  await writeAuditLog({
    action: 'message.deleted.for_everyone',
    actor:  { uid },
    target: { type: 'message', id: data.messageId },
    result: 'success',
    metadata: { conversationId: data.conversationId, messageId: data.messageId, byRole },
  });

  return { ok: true };
});
