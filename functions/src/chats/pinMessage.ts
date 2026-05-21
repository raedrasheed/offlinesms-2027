// Callable: pin/unpin a message.
//
// Direct chats: any participant may pin/unpin.
// Group chats:  owner / admin only.
// One pinned message per conversation in Phase 6 (a new pin replaces the
// previous one). Audited as message.pinned / message.unpinned.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const PREVIEW_MAX = 80;

function buildPreview(text: string): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW_MAX ? t.slice(0, PREVIEW_MAX - 1) + '…' : t;
}

export const pinMessage = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; messageId?: unknown; pinned?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId)
    throw new HttpsError('invalid-argument', 'conversationId-required');
  if (typeof data.messageId !== 'string' || !data.messageId)
    throw new HttpsError('invalid-argument', 'messageId-required');
  const pinned = data.pinned === true;

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

  if (convo.type === 'group') {
    const memberSnap = await convoRef.collection('members').doc(uid).get();
    const role = (memberSnap.data()?.role ?? '') as string;
    if (role !== 'owner' && role !== 'admin') {
      throw new HttpsError('permission-denied', 'admins-only');
    }
  }

  const msg = msgSnap.data() as { senderUid?: string; senderId?: string; text?: string; senderDisplayName?: string; deletedForEveryone?: boolean };
  if (msg.deletedForEveryone) throw new HttpsError('failed-precondition', 'message-deleted');

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();

  if (pinned) {
    batch.update(msgRef, { pinnedAt: now, pinnedBy: uid, updatedAt: now });
    batch.update(convoRef, {
      pinnedMessage: {
        messageId: data.messageId,
        senderUid: msg.senderUid ?? msg.senderId ?? '',
        senderDisplayName: msg.senderDisplayName ?? null,
        preview:   buildPreview(msg.text ?? ''),
        pinnedAt:  now,
        pinnedBy:  uid,
      },
      updatedAt: now,
    });
  } else {
    batch.update(msgRef, { pinnedAt: null, pinnedBy: null, updatedAt: now });
    batch.update(convoRef, { pinnedMessage: null, updatedAt: now });
  }

  await batch.commit();

  await writeAuditLog({
    action: pinned ? 'message.pinned' : 'message.unpinned',
    actor:  { uid },
    target: { type: 'message', id: data.messageId },
    result: 'success',
    metadata: { conversationId: data.conversationId, messageId: data.messageId },
  });

  return { ok: true, pinned };
});
