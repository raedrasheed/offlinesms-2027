// Invitations are private to the recipient. Only accepting creates membership.
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { publicNameFrom } from '../lib/displayName';
import { sendPushToUser } from '../notifications/send';

// Bounds work in one callable/transaction, not the group's total membership.
// Additional requests can invite more people to an existing group.
export const MAX_GROUP_INVITE_BATCH = 240;
export const invitationRef = (uid: string, cid: string) =>
  getFirestore().collection('users').doc(uid).collection('groupInvitations').doc(cid);
export function invitationData(cid: string, inviterUid: string, group: FirebaseFirestore.DocumentData) {
  return { conversationId: cid, inviterUid, groupName: group.name ?? '',
    status: 'pending', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
}

/** Used for explicit invitations and for contacts who register later. */
export async function inviteGroupMembers(cid: string, inviterUid: string, targets: string[]) {
  if (targets.length > MAX_GROUP_INVITE_BATCH) throw new HttpsError('invalid-argument', 'too-many-recipients-in-request');
  const db = getFirestore(), ref = db.collection('conversations').doc(cid);
  return db.runTransaction(async tx => {
    const group = await tx.get(ref), admin = await tx.get(ref.collection('members').doc(inviterUid));
    const g = group.data();
    if (!g || g.type !== 'group' || g.status === 'deleted' || g.status === 'archived' || g.status === 'disabled') throw new HttpsError('failed-precondition', 'group-unavailable');
    if (!(g.participantUids ?? []).includes(inviterUid) || (admin.data()?.status ?? 'active') !== 'active' || !['owner', 'admin'].includes(admin.data()?.role)) throw new HttpsError('permission-denied', 'admins-only');
    const uids = [...new Set(targets)].filter(u => u !== inviterUid && !(g.participantUids ?? []).includes(u));
    const rows = await Promise.all(uids.map(async u => ({ uid: u,
      user: await tx.get(db.collection('users').doc(u)), invite: await tx.get(invitationRef(u, cid)),
      blocked: await tx.get(db.doc(`users/${u}/blockedUsers/${inviterUid}`)),
      blockedBySender: await tx.get(db.doc(`users/${inviterUid}/blockedUsers/${u}`)),
    })));
    let invited = 0;
    for (const row of rows) {
      if (!row.user.exists) throw new HttpsError('not-found', 'user-not-found');
      // A decline is sticky. Repeating an add must not override the recipient's choice.
      if (row.blocked.exists || row.blockedBySender.exists || ['pending', 'declined'].includes(row.invite.data()?.status)) continue;
      tx.set(invitationRef(row.uid, cid), invitationData(cid, inviterUid, g)); invited++;
    }
    return { added: 0, invited };
  });
}

export const respondToGroupInvitation = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const { conversationId: cid, accept } = request.data ?? {};
  if (typeof cid !== 'string' || !cid || cid.includes('/') || typeof accept !== 'boolean') throw new HttpsError('invalid-argument', 'invalid-invitation');
  const db = getFirestore(), ref = db.collection('conversations').doc(cid), invite = invitationRef(uid, cid);
  return db.runTransaction(async tx => {
    const snap = await tx.get(invite), invitation = snap.data();
    if (!invitation) throw new HttpsError('not-found', 'invitation-not-found');
    if (invitation.status !== 'pending') {
      if (invitation.status === (accept ? 'accepted' : 'declined')) return { status: invitation.status, conversationId: cid };
      throw new HttpsError('failed-precondition', 'invitation-closed');
    }
    const now = FieldValue.serverTimestamp();
    if (!accept) { tx.update(invite, { status: 'declined', updatedAt: now }); return { status: 'declined', conversationId: cid }; }
    const group = await tx.get(ref), profile = await tx.get(db.collection('users').doc(uid));
    const admin = await tx.get(ref.collection('members').doc(invitation.inviterUid));
    const blocked = await tx.get(db.doc(`users/${uid}/blockedUsers/${invitation.inviterUid}`));
    const blockedBySender = await tx.get(db.doc(`users/${invitation.inviterUid}/blockedUsers/${uid}`));
    const externals = await tx.get(ref.collection('externalMembers').where('linkedUid', '==', uid));
    const g = group.data();
    if (!g || g.type !== 'group' || g.status === 'deleted' || g.status === 'archived' || g.status === 'disabled' || !profile.exists) throw new HttpsError('failed-precondition', 'group-unavailable');
    if (!(g.participantUids ?? []).includes(invitation.inviterUid) || (admin.data()?.status ?? 'active') !== 'active' || !['owner', 'admin'].includes(admin.data()?.role) || blocked.exists || blockedBySender.exists) throw new HttpsError('failed-precondition', 'invitation-unavailable');
    const participants: string[] = g.participantUids ?? [];
    if (!participants.includes(uid)) {
      const externalCount = Math.max(0, (g.externalMemberCount ?? 0) - externals.size);
      const next = [...participants, uid];
      tx.update(ref, { participantUids: next, memberIds: next, memberCount: next.length, externalMemberCount: externalCount, updatedAt: now });
      // Retire external entries once the recipient explicitly joins, avoiding double SMS/counts.
      for (const external of externals.docs) tx.delete(external.ref);
      tx.set(ref.collection('members').doc(uid), { uid, role: 'member', status: 'active', addedBy: invitation.inviterUid,
        displayNameSnapshot: publicNameFrom(profile.data(), uid), photoURLSnapshot: profile.data()?.photoURL ?? null, joinedAt: now, updatedAt: now });
      tx.set(ref.collection('userState').doc(uid), { uid, pinned: false, muted: false, archived: false, favorite: false,
        unreadCount: 0, lastReadAt: now, lastMessagePreview: '', lastMessageAt: now, updatedAt: now });
    }
    tx.update(invite, { status: 'accepted', updatedAt: now });
    return { status: 'accepted', conversationId: cid };
  });
});

export const notifyGroupInvitation = onDocumentWritten('users/{uid}/groupInvitations/{conversationId}', async event => {
  const after = event.data?.after.data();
  if (!after || after.status !== 'pending' || event.data?.before.data()?.status === 'pending') return;
  await sendPushToUser(event.params.uid, { title: 'Group invitation · دعوة مجموعة', body: after.groupName,
    data: { type: 'group_invitation' } });
});
