// Callable: add members to a group. Owner/admin only (respecting
// settings.onlyAdminsCanAddMembers). Caps at MAX_GROUP_MEMBERS.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { publicNameFrom } from '../lib/displayName';
import { MAX_GROUP_MEMBERS } from './createGroup';

export const addMembers = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { conversationId?: unknown; memberUids?: unknown };
  if (typeof data.conversationId !== 'string' || !data.conversationId) {
    throw new HttpsError('invalid-argument', 'conversationId-required');
  }
  if (!Array.isArray(data.memberUids)) {
    throw new HttpsError('invalid-argument', 'memberUids-required');
  }

  const db = getFirestore();
  const convoRef = db.collection('conversations').doc(data.conversationId);

  const [convoSnap, callerMemberSnap] = await Promise.all([
    convoRef.get(),
    convoRef.collection('members').doc(uid).get(),
  ]);

  if (!convoSnap.exists) throw new HttpsError('not-found', 'conversation-not-found');
  const convo = convoSnap.data() as {
    type?: string;
    participantUids?: string[];
    memberCount?: number;
    settings?: { onlyAdminsCanAddMembers?: boolean };
  };
  if (convo.type !== 'group') throw new HttpsError('failed-precondition', 'not-a-group');

  const callerRole = (callerMemberSnap.data()?.role ?? '') as string;
  const callerActive = (callerMemberSnap.data()?.status ?? 'active') === 'active';
  if (!callerActive) throw new HttpsError('permission-denied', 'not-a-member');

  const onlyAdmins = convo.settings?.onlyAdminsCanAddMembers === true;
  if (onlyAdmins && callerRole !== 'owner' && callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'admins-only');
  }
  // Even when onlyAdmins is false, ordinary participants currently cannot
  // add members in Phase 5 (matches WhatsApp-style defaults). Loosen here
  // if/when the product wants the toggle to flip the other way.
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new HttpsError('permission-denied', 'admins-only');
  }

  const existing = new Set(convo.participantUids ?? []);
  const rawAdd = ((data.memberUids as unknown[]).filter(x => typeof x === 'string') as string[])
    .filter(u => u && u !== uid && !existing.has(u));
  const toAdd = Array.from(new Set(rawAdd));
  if (toAdd.length === 0) return { added: 0 };

  if ((convo.memberCount ?? existing.size) + toAdd.length > MAX_GROUP_MEMBERS) {
    throw new HttpsError('failed-precondition', 'too-many-members');
  }

  // Confirm every target uid exists.
  const userSnaps = await Promise.all(
    toAdd.map(u => db.collection('users').doc(u).get())
  );
  for (let i = 0; i < userSnaps.length; i++) {
    if (!userSnaps[i].exists) {
      throw new HttpsError('not-found', `user-not-found:${toAdd[i]}`);
    }
  }

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  const nextParticipants = [...(convo.participantUids ?? []), ...toAdd];

  batch.update(convoRef, {
    participantUids: nextParticipants,
    memberIds:       nextParticipants,
    memberCount:     nextParticipants.length,
    updatedAt:       now,
  });

  for (let i = 0; i < toAdd.length; i++) {
    const u = toAdd[i];
    const profile = (userSnaps[i].data() ?? {}) as { displayName?: string; username?: string; photoURL?: string };
    batch.set(convoRef.collection('members').doc(u), {
      uid: u,
      role: 'member',
      status: 'active',
      addedBy: uid,
      displayNameSnapshot: publicNameFrom(profile, u), // null, never the uid
      photoURLSnapshot: profile.photoURL ?? null,
      joinedAt: now,
      updatedAt: now,
    }, { merge: true });
    batch.set(convoRef.collection('userState').doc(u), {
      uid: u,
      pinned: false, muted: false, archived: false, favorite: false,
      unreadCount: 0,
      lastReadAt: now,
      lastMessagePreview: '',
      lastMessageAt: now,
      updatedAt: now,
    }, { merge: true });
  }

  await batch.commit();

  await writeAuditLog({
    action: 'group.member.added',
    actor: { uid },
    target: { type: 'conversation', id: convoRef.id },
    result: 'success',
    metadata: {
      conversationId: convoRef.id,
      added: toAdd.length,
    },
  });

  return { added: toAdd.length };
});
