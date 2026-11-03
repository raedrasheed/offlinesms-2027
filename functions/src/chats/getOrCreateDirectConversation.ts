// Callable: get-or-create a 1:1 direct conversation between the caller and
// another existing user. Audited; never sees message content.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { createHash } from 'node:crypto';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

function directKey(a: string, b: string): string {
  return [a, b].sort().join('_');
}

export const getOrCreateDirectConversation = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { otherUserId?: unknown };
  if (typeof data.otherUserId !== 'string' || !data.otherUserId || data.otherUserId.length > 128 || data.otherUserId.includes('/')) {
    throw new HttpsError('invalid-argument', 'otherUserId-required');
  }
  const otherUid = data.otherUserId;
  if (otherUid === uid) {
    throw new HttpsError('invalid-argument', 'cannot-chat-with-self');
  }

  const db = getFirestore();

  // Reject if the other user doesn't exist.
  const otherSnap = await db.collection('users').doc(otherUid).get();
  if (!otherSnap.exists || (otherSnap.get('status') ?? 'active') !== 'active') {
    throw new HttpsError('not-found', 'other-user-not-found');
  }

  const participantKey = directKey(uid, otherUid);

  // Look up an existing direct conversation by participantKey.
  const existing = await db.collection('conversations')
    .where('participantKey', '==', participantKey)
    .limit(1)
    .get();

  const belongsToPair = (value: FirebaseFirestore.DocumentData) => {
    const members = value.participantUids ?? value.memberIds;
    return value.type === 'direct' && Array.isArray(members) && members.length === 2
      && members.includes(uid) && members.includes(otherUid);
  };
  if (!existing.empty && belongsToPair(existing.docs[0].data())) {
    const conversationId = existing.docs[0].id;
    return { conversationId, created: false };
  }

  // Keep old random conversation ids above. New pairs use an unambiguous,
  // stable key so simultaneous opens/replies from either device create once.
  const directId = 'direct_' + createHash('sha256').update(JSON.stringify([uid, otherUid].sort())).digest('hex');
  const convoRef = db.collection('conversations').doc(directId);
  const now = FieldValue.serverTimestamp();
  const participantUids = [uid, otherUid];

  const created = await db.runTransaction(async tx => {
    const current = await tx.get(convoRef);
    if (current.exists) {
      if (!belongsToPair(current.data()!)) throw new HttpsError('failed-precondition', 'direct-conversation-conflict');
      return false;
    }
    tx.create(convoRef, {
      type:            'direct',
      participantUids,
      participantKey,
      createdBy:       uid,
      status:          'active',
      lastMessage:     null,
      createdAt:       now,
      updatedAt:       now,

      // back-compat aliases for the legacy trigger / dashboard / seed.
      memberIds:       participantUids,
      lastMessageText: '',
      // Opening a person is not a message. The first message fan-out supplies
      // the inbox timestamp and preview for both participants.
      lastMessageAt:   null,
      lastSenderId:    '',
    });

    for (const u of participantUids) {
      tx.set(convoRef.collection('userState').doc(u), {
        uid:                u,
        pinned:             false,
        muted:              false,
        archived:           false,
        favorite:           false,
        unreadCount:        0,
        lastReadAt:         now,
        lastMessagePreview: '',
        lastMessageAt:      null,
        updatedAt:          now,
      });
    }

    return true;
  });

  if (created) await writeAuditLog({
    action: 'chat.directConversation.opened',
    actor:  { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: {
      participantKey,
      otherUid,
    },
  });

  return { conversationId: convoRef.id, created };
});
