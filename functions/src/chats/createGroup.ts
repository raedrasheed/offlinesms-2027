// Callable: create a group conversation.
//
// The caller becomes owner. Member uids are deduplicated, must exist in
// /users, and are capped at MAX_GROUP_MEMBERS. Audited as group.created
// with sanitised metadata only.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, type WriteBatch } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { publicNameFrom } from '../lib/displayName';

export const MAX_GROUP_MEMBERS = 256;
const NAME_MAX = 80;

type CreateGroupRequest = {
  name?:       unknown;
  memberUids?: unknown;
  avatarUrl?:  unknown;
};

export const createGroup = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as CreateGroupRequest;
  if (typeof data.name !== 'string') {
    throw new HttpsError('invalid-argument', 'name-required');
  }
  const name = data.name.trim();
  if (name.length === 0) throw new HttpsError('invalid-argument', 'name-empty');
  if (name.length > NAME_MAX) throw new HttpsError('invalid-argument', 'name-too-long');

  if (!Array.isArray(data.memberUids)) {
    throw new HttpsError('invalid-argument', 'memberUids-required');
  }
  const rawMembers = (data.memberUids as unknown[]).filter(x => typeof x === 'string') as string[];

  // Owner always included; de-dup; exclude self from the "others" list.
  const others = Array.from(new Set(rawMembers.filter(u => u && u !== uid)));
  if (others.length === 0) throw new HttpsError('invalid-argument', 'at-least-one-other-member-required');

  const participantUids = [uid, ...others];
  if (participantUids.length > MAX_GROUP_MEMBERS) {
    throw new HttpsError('invalid-argument', 'too-many-members');
  }

  const avatarUrl = typeof data.avatarUrl === 'string' && data.avatarUrl.length > 0
    ? data.avatarUrl
    : null;

  const db = getFirestore();

  // Fetch each member's display name in parallel — used as a UI snapshot.
  const memberSnaps = await Promise.all(
    participantUids.map(u => db.collection('users').doc(u).get())
  );
  for (let i = 0; i < memberSnaps.length; i++) {
    if (!memberSnaps[i].exists) {
      throw new HttpsError('not-found', `user-not-found:${participantUids[i]}`);
    }
  }

  const convoRef = db.collection('conversations').doc();
  const now = FieldValue.serverTimestamp();
  const batch: WriteBatch = db.batch();

  batch.set(convoRef, {
    type:        'group',
    name,
    avatarUrl,
    createdBy:   uid,
    ownerUid:    uid,
    participantUids,
    participantKey: null,
    memberCount: participantUids.length,
    status:      'active',
    settings: {
      onlyAdminsCanSend:       false,
      onlyAdminsCanEditInfo:   true,
      onlyAdminsCanAddMembers: false,
    },
    lastMessage: null,
    createdAt:   now,
    updatedAt:   now,

    // Back-compat aliases used by the existing trigger / dashboard / seed.
    memberIds:       participantUids,
    lastMessageText: '',
    lastMessageAt:   now,
    lastSenderId:    '',
  });

  // members + userState for everyone.
  for (let i = 0; i < participantUids.length; i++) {
    const u = participantUids[i];
    const snap = memberSnaps[i];
    const profile = (snap.data() ?? {}) as { displayName?: string; username?: string; photoURL?: string };
    batch.set(convoRef.collection('members').doc(u), {
      uid: u,
      role: u === uid ? 'owner' : 'member',
      status: 'active',
      addedBy: uid,
      // Name snapshot (fallback only — clients resolve live). Null, never the uid.
      displayNameSnapshot: publicNameFrom(profile, u),
      photoURLSnapshot: profile.photoURL ?? null,
      joinedAt: now,
      updatedAt: now,
    });
    batch.set(convoRef.collection('userState').doc(u), {
      uid: u,
      pinned: false, muted: false, archived: false, favorite: false,
      unreadCount: 0,
      lastReadAt: now,
      lastMessagePreview: '',
      lastMessageAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();

  await writeAuditLog({
    action: 'group.created',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: {
      conversationId: convoRef.id,
      memberCount: participantUids.length,
    },
  });

  return { conversationId: convoRef.id, memberCount: participantUids.length };
});
