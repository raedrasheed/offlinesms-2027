// Trigger: linkPhoneContactsOnUserWrite — when a user's phoneNumber is set or
// changed, retro-link any external phone contacts that match that number.
//
// For every matching record we set isRegistered:true + linkedUid:uid:
//   - phoneContacts/{contactId}            (the owner's private contact)
//   - conversations/*/externalMembers/{id} (group external rosters)
//
// Group promotion: where an external member matched, we ALSO merge the user
// into that group's real roster (participantUids + members/{uid} + userState)
// so they receive in-app messages like any registered member. The external
// member doc is NOT deleted — it's flipped to isRegistered + marked
// `migratedToMemberAt`, so history is preserved and the SMS recipient
// calculation (which skips registered participants) won't double-send.

import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { phoneDigits } from '../lib/phone';

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

export const linkPhoneContactsOnUserWrite = onDocumentWritten('users/{uid}', async (event) => {
  const uid = (event.params as { uid: string }).uid;
  const before = event.data?.before?.data() as { phoneNumber?: string } | undefined;
  const after  = event.data?.after?.data()  as { phoneNumber?: string; displayName?: string; photoURL?: string } | undefined;
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
    try {
      await db.runTransaction(async tx => {
        const convo = await tx.get(convoRef);
        if (!convo.exists) return;
        const data = convo.data() as { participantUids?: string[]; memberCount?: number };

        // Always mark the external row registered + linked, preserving it.
        tx.set(ext.ref, { isRegistered: true, linkedUid: uid, migratedToMemberAt: now, updatedAt: now }, { merge: true });

        // Promote into the real roster (idempotent — skip if already a member).
        if (shouldPromoteToMember(data.participantUids, uid)) {
          const next = [...(data.participantUids ?? []), uid];
          tx.update(convoRef, { participantUids: next, memberIds: next, memberCount: next.length, updatedAt: now });
          tx.set(convoRef.collection('members').doc(uid), {
            uid, role: 'member', status: 'active', addedBy: 'system:link',
            displayNameSnapshot: after.displayName ?? uid,
            photoURLSnapshot: after.photoURL ?? null,
            joinedAt: now, updatedAt: now,
          }, { merge: true });
          tx.set(convoRef.collection('userState').doc(uid), {
            uid, pinned: false, muted: false, archived: false, favorite: false,
            unreadCount: 0, lastReadAt: now, lastMessagePreview: '', lastMessageAt: now, updatedAt: now,
          }, { merge: true });
        }
      });
    } catch { /* best-effort per group; a failed group is retried on next user write */ }
  }
});
