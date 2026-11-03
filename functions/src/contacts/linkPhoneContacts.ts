// Linking a phone sends invitations; it never grants group membership.
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { phoneDigits } from '../lib/phone';
import { inviteGroupMembers } from '../chats/memberInvitations';

/** Pure: should this user be promoted into the group's real roster? */
export function shouldPromoteToMember(participantUids: string[] | undefined, uid: string): boolean {
  return !(participantUids ?? []).includes(uid);
}

/** Pure: did the phone number meaningfully change (set or differ)? */
export function phoneChanged(before: string | null | undefined, after: string | null | undefined): boolean {
  const b = (before ?? '') as string;
  const a = (after ?? '') as string;
  return !!a && a !== b;
}

// F1 Phase B: phoneNumber now lives in users/{uid}/userPrivate/profile, so this
// trigger fires on that subdoc write (not the public users/{uid} doc). The
// non-PII display fields for the promotion snapshot are read from the public doc.
export const linkPhoneContactsOnUserWrite = onDocumentWritten({ document: 'users/{uid}/userPrivate/{doc}', retry: true }, async (event) => {
  const { uid, doc } = event.params as { uid: string; doc: string };
  if (doc !== 'profile') return;
  const before = event.data?.before?.data() as { phoneNumber?: string } | undefined;
  const after  = event.data?.after?.data()  as { phoneNumber?: string } | undefined;
  if (!after) return;                                  // deleted
  if (!phoneChanged(before?.phoneNumber, after.phoneNumber)) return;

  const e164 = after.phoneNumber as string;
  const digits = phoneDigits(e164);
  if (!digits) return;

  const db = getFirestore();
  const now = FieldValue.serverTimestamp();

  // 1. Flip the owner's private phone contacts that match this number.
  const contactSnap = await db.collection('phoneContacts').where('normalizedPhone', '==', digits).get();
  if (!contactSnap.empty) {
    const batch = db.batch();
    for (const d of contactSnap.docs) {
      batch.set(d.ref, { isRegistered: true, linkedUid: uid, updatedAt: now }, { merge: true });
    }
    await batch.commit();
  }

  // 2. Flip + promote group external members that match this number.
  const extSnap = await db.collectionGroup('externalMembers').where('normalizedPhone', '==', digits).get();
  for (const ext of extSnap.docs) {
    const convoRef = ext.ref.parent.parent;            // conversations/{id}
    if (!convoRef) continue;
    await ext.ref.set({ isRegistered: true, linkedUid: uid, updatedAt: now }, { merge: true });
    const group = await convoRef.get();
    const inviter = ext.data().addedByUid || group.data()?.ownerUid;
    if (inviter) await inviteGroupMembers(convoRef.id, inviter, [uid]).catch(error => {
      // Invalid/departed admins cannot invite; other failures must retry the event.
      if (!['permission-denied', 'failed-precondition'].includes(error?.code)) throw error;
    });
  }
});
