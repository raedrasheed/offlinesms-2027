// Callable: deleteMyAccount — self-service account deletion (App Store / Play
// Store requirement + privacy/erasure).
//
// The caller can only delete their OWN account (request.auth.uid). Steps:
//   1. Free the username (so it can be reclaimed).
//   2. Delete the user's private data: profile doc + subcollections (devices,
//      notifications, notificationSettings, blockedUsers), wallet, quota docs.
//   3. Leave groups (mark membership 'left' + drop from participantUids) so the
//      user stops appearing as an active member. Direct chats are left intact —
//      they are the peer's history.
//   4. Delete the Firebase Auth user (frees the phone number for re-signup).
//
// Firestore cleanup is best-effort (each step is isolated) so a single failure
// never blocks the critical Auth deletion. Historical messages the user already
// sent into conversations are retained (they belong to the recipients); with the
// profile gone the UI falls back to a generic sender.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';

const REGION = 'us-central1';
const MAX_CONVERSATIONS = 500;

/** Delete every document in a (sub)collection, in batches. Best-effort. */
async function deleteAllDocs(
  db: FirebaseFirestore.Firestore,
  ref: FirebaseFirestore.CollectionReference,
  cap = 1000,
): Promise<void> {
  let removed = 0;
  while (removed < cap) {
    const snap = await ref.limit(300).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    removed += snap.size;
    if (snap.size < 300) break;
  }
}

export const deleteMyAccount = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const db = getFirestore();
  const userRef = db.collection('users').doc(uid);

  // Read the profile up front (need usernameLower to free the handle).
  const userSnap = await userRef.get();
  const usernameLower = (userSnap.data()?.usernameLower as string | undefined) ?? null;

  // 1. Free the username (only if the reverse index still points at us).
  if (usernameLower) {
    try {
      const nameRef = db.collection('usernames').doc(usernameLower);
      const nameSnap = await nameRef.get();
      if (nameSnap.exists && nameSnap.data()?.uid === uid) await nameRef.delete();
    } catch { /* best-effort */ }
  }

  // 2. Leave groups + drop from participant lists (bounded fan-out).
  try {
    const convos = await db.collection('conversations')
      .where('participantUids', 'array-contains', uid)
      .limit(MAX_CONVERSATIONS)
      .get();
    for (const c of convos.docs) {
      try {
        const isGroup = (c.data()?.type as string | undefined) === 'group';
        if (isGroup) {
          const batch = db.batch();
          batch.update(c.ref, { participantUids: FieldValue.arrayRemove(uid), updatedAt: FieldValue.serverTimestamp() });
          batch.set(c.ref.collection('members').doc(uid),
            { status: 'left', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          batch.delete(c.ref.collection('userState').doc(uid));
          await batch.commit();
        } else {
          // Direct chat: keep the thread for the peer; just clear my per-chat state.
          await c.ref.collection('userState').doc(uid).delete().catch(() => {});
        }
      } catch { /* skip this conversation */ }
    }
  } catch { /* best-effort */ }

  // 3. Delete private subcollections + per-user docs.
  // userPrivate holds the phone number / email (PII) and must not outlive the
  // account; leaving it behind would also keep the number looking "taken".
  for (const sub of ['devices', 'notifications', 'notificationSettings', 'blockedUsers', 'userPrivate']) {
    try { await deleteAllDocs(db, userRef.collection(sub)); } catch { /* best-effort */ }
  }
  for (const path of [
    db.collection('wallets').doc(uid),
    db.collection('smsQuotaUsage').doc(uid),
    db.collection('transferQuotaUsage').doc(uid),
  ]) {
    try { await path.delete(); } catch { /* best-effort */ }
  }
  try { await userRef.delete(); } catch { /* best-effort */ }

  // Phone linking: release the number claim and drop link/challenge state so
  // the number can be linked again (by its owner, to a new account).
  try {
    const claims = await db.collection('phoneClaims').where('uid', '==', uid).limit(10).get();
    const batch = db.batch();
    claims.docs.forEach(d => batch.delete(d.ref));
    batch.delete(db.collection('phoneLinkOps').doc(uid));
    batch.delete(db.collection('phoneLinkChallenges').doc(uid));
    batch.delete(db.collection('emailChangeOps').doc(uid));
    batch.delete(db.collection('emailChangeChallenges').doc(uid));
    batch.delete(db.collection('emailChangeAuthWrites').doc(uid));
    await batch.commit();
  } catch { /* best-effort; a dead owner's claim is treated as stale */ }

  // 4. Delete the Auth user — the critical step (frees the phone number).
  try {
    await getAuth().deleteUser(uid);
  } catch (e: any) {
    await writeAuditLog({
      action: 'account.deleted', actor: { uid },
      target: { type: 'user', id: uid }, result: 'failure',
      metadata: { reason: 'auth-delete-failed' },
    });
    throw new HttpsError('internal', 'account-delete-failed');
  }

  await writeAuditLog({
    action: 'account.deleted', actor: { uid },
    target: { type: 'user', id: uid }, result: 'success',
    metadata: { usernameFreed: !!usernameLower },
  });

  return { ok: true };
});
