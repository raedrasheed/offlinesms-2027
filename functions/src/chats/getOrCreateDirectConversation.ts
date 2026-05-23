// Callable: get-or-create a 1:1 direct conversation between the caller and
// another existing user. Audited; never sees message content.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

function directKey(a: string, b: string): string {
  return [a, b].sort().join('_');
}

export const getOrCreateDirectConversation = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { otherUserId?: unknown };
  if (typeof data.otherUserId !== 'string' || !data.otherUserId) {
    throw new HttpsError('invalid-argument', 'otherUserId-required');
  }
  const otherUid = data.otherUserId;
  if (otherUid === uid) {
    throw new HttpsError('invalid-argument', 'cannot-chat-with-self');
  }

  const db = getFirestore();

  // Reject if the other user doesn't exist.
  const otherSnap = await db.collection('users').doc(otherUid).get();
  if (!otherSnap.exists) {
    throw new HttpsError('not-found', 'other-user-not-found');
  }

  const participantKey = directKey(uid, otherUid);

  // Look up an existing direct conversation by participantKey.
  const existing = await db.collection('conversations')
    .where('participantKey', '==', participantKey)
    .limit(1)
    .get();

  if (!existing.empty) {
    const conversationId = existing.docs[0].id;
    return { conversationId, created: false };
  }

  // Create it. Write canonical Phase 4 fields and back-compat aliases.
  const convoRef = db.collection('conversations').doc();
  const now = FieldValue.serverTimestamp();
  const participantUids = [uid, otherUid];

  const batch = db.batch();
  batch.set(convoRef, {
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
    lastMessageAt:   now,
    lastSenderId:    '',
  });

  for (const u of participantUids) {
    batch.set(convoRef.collection('userState').doc(u), {
      uid:                u,
      pinned:             false,
      muted:              false,
      archived:           false,
      favorite:           false,
      unreadCount:        0,
      lastReadAt:         now,
      lastMessagePreview: '',
      lastMessageAt:      now,
      updatedAt:          now,
    });
  }

  await batch.commit();

  await writeAuditLog({
    action: 'chat.directConversation.opened',
    actor:  { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: {
      participantKey,
      otherUid,
    },
  });

  return { conversationId: convoRef.id, created: true };
});
