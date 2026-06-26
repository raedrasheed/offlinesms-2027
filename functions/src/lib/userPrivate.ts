// Sensitive user PII at rest (F1, Phase A — dual-write only).
//
// Phase A mirrors a user's sensitive fields into an owner/admin-only private
// subdocument `users/{uid}/private/profile`, WHILE the public `users/{uid}` doc
// keeps carrying the same fields unchanged. Reads are NOT switched yet and the
// public fields are NOT removed yet — those are Phase B / Phase C.
//
// Rules (firestore.rules): users/{uid}/private/{doc} is readable/writable only by
// the owner or an admin, so the PII is no longer exposed to every signed-in user
// once reads move there.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/** Fields stored in the private profile subdoc. All optional — callers pass
 *  only what they have; undefined keys are dropped so a partial merge is safe. */
export interface UserPrivateProfile {
  phoneNumber?: string | null;
  email?: string | null;
  pinHash?: string | null;
  pinSalt?: string | null;
  pinSetAt?: FirebaseFirestore.FieldValue | FirebaseFirestore.Timestamp | null;
}

export function userPrivateProfileRef(
  db: FirebaseFirestore.Firestore,
  uid: string,
): FirebaseFirestore.DocumentReference {
  return db.collection('users').doc(uid).collection('private').doc('profile');
}

/**
 * Phase A dual-write: merge the given sensitive fields into
 * users/{uid}/private/profile (+ updatedAt). Idempotent (merge). Only keys that
 * are explicitly provided (including explicit null) are written; `undefined`
 * keys are skipped so we never clobber an existing value with undefined.
 */
export async function writeUserPrivateProfile(
  db: FirebaseFirestore.Firestore,
  uid: string,
  fields: UserPrivateProfile,
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) payload[k] = v;
  }
  await userPrivateProfileRef(db, uid).set(payload, { merge: true });
}

// Convenience for callers that only have the default Firestore instance.
export async function dualWriteUserPrivateProfile(uid: string, fields: UserPrivateProfile): Promise<void> {
  await writeUserPrivateProfile(getFirestore(), uid, fields);
}
