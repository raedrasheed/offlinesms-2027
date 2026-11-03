// Callable: create a group conversation.
//
// The caller becomes the sole active owner. Registered recipients receive
// private invitations; phone recipients may receive SMS without registration. Audited as group.created
// with sanitised metadata only.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, type WriteBatch } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { publicNameFrom } from '../lib/displayName';

import { GROUP_CAP, invitationRef, invitationData } from './memberInvitations';
import { assertDirectNotBlocked } from './blockGuard';
import { normalizePhoneToE164 } from '../lib/phone';
import { newExternalMemberDoc, newPhoneContactDoc } from '../contacts/contactLogic';
import { findRegisteredUidByPhone } from '../contacts/createPhoneContact';
export const MAX_GROUP_MEMBERS = GROUP_CAP;
const NAME_MAX = 80;

type CreateGroupRequest = {
  name?:       unknown;
  memberUids?: unknown;
  avatarUrl?:  unknown;
  externalContacts?: unknown;
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
  if (data.memberUids.length > MAX_GROUP_MEMBERS - 1) throw new HttpsError('invalid-argument', 'too-many-members');
  const rawMembers = (data.memberUids as unknown[]).filter(x => typeof x === 'string') as string[];

  // Owner always included; de-dup; exclude self from the "others" list.
  const others = Array.from(new Set(rawMembers.filter(u => u && u !== uid)));
  if (data.externalContacts !== undefined && !Array.isArray(data.externalContacts)) throw new HttpsError('invalid-argument', 'invalid-contacts');
  const external = new Map<string, { displayName: string; e164: string; linkedUid: string | null }>();
  // Keep the atomic create below 500 writes (group, owner and invitations/phone rows).
  if (((data.externalContacts as unknown[] | undefined)?.length ?? 0) > 240) throw new HttpsError('invalid-argument', 'too-many-members');
  for (const item of (data.externalContacts ?? []) as any[]) {
    const e164 = typeof item?.phoneNumber === 'string' ? normalizePhoneToE164(item.phoneNumber, 'PS') : null;
    const displayName = typeof item?.displayName === 'string' ? item.displayName.trim() : '';
    if (!e164 || !displayName || displayName.length > 80) throw new HttpsError('invalid-argument', 'invalid-contact');
    const linkedUid = await findRegisteredUidByPhone(e164);
    if (linkedUid === uid) continue;
    external.set(e164, { displayName, e164, linkedUid });
    if (linkedUid && !others.includes(linkedUid)) others.push(linkedUid);
  }
  if (!others.length && !external.size) throw new HttpsError('invalid-argument', 'at-least-one-recipient-required');
  if (others.length + external.size > 480 || 1 + others.length + [...external.values()].filter(c => !c.linkedUid).length > MAX_GROUP_MEMBERS) throw new HttpsError('invalid-argument', 'too-many-members');
  for (const target of others) {
    if (target.includes('/')) throw new HttpsError('invalid-argument', 'invalid-member');
    await assertDirectNotBlocked(getFirestore(), { type: 'direct', participantUids: [uid, target] }, uid);
  }

  const participantUids = [uid];

  const avatarUrl = typeof data.avatarUrl === 'string' && data.avatarUrl.length > 0
    ? data.avatarUrl
    : null;

  const db = getFirestore();

  // Fetch each member's display name in parallel — used as a UI snapshot.
  const memberSnaps = await Promise.all(
    [uid, ...others].map(u => db.collection('users').doc(u).get())
  );
  for (let i = 0; i < memberSnaps.length; i++) {
    if (!memberSnaps[i].exists) {
      throw new HttpsError('not-found', `user-not-found:${[uid, ...others][i]}`);
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
    externalMemberCount: external.size,
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

  // Only the owner has membership/userState until each recipient accepts.
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

  for (const target of others) batch.set(invitationRef(target, convoRef.id), invitationData(convoRef.id, uid, { name }));
  for (const contact of external.values()) {
    const privateContact = newPhoneContactDoc({ ownerUid: uid, ...contact });
    batch.set(convoRef.collection('externalMembers').doc(contact.e164.replace(/\D/g, '')), {
      ...newExternalMemberDoc({ contactId: privateContact.contactId, addedByUid: uid, ...contact }), addedAt: now, updatedAt: now,
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
