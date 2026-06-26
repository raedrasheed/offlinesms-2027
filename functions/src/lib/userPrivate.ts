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

// ── Phase B reads (private-first, with a public-field fallback) ───────────────

/**
 * Read a user's phone (Phase B): private/profile first; if absent (e.g. a user
 * created before the Phase A backfill ran), fall back to the still-present
 * public users/{uid}.phoneNumber. Admin SDK only.
 */
export async function readUserPhone(
  db: FirebaseFirestore.Firestore,
  uid: string,
): Promise<string | null> {
  const priv = await userPrivateProfileRef(db, uid).get();
  const p = priv.exists ? (priv.get('phoneNumber') as string | null | undefined) : undefined;
  if (p) return p;
  const pub = await db.collection('users').doc(uid).get();
  return (pub.get('phoneNumber') as string | null | undefined) ?? null;
}

/**
 * Resolve phone E.164 → uid via the private/profile collection group (Phase B
 * discovery). Pass ≤ Firestore's `in` limit (callers chunk). Admin SDK only;
 * requires the COLLECTION_GROUP index on private.phoneNumber to be Enabled.
 */
export async function findUidsByPhoneNumbers(
  db: FirebaseFirestore.Firestore,
  phones: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (phones.length === 0) return out;
  const snap = await db.collectionGroup('private').where('phoneNumber', 'in', phones).get();
  for (const d of snap.docs) {
    if (d.id !== 'profile') continue;                 // only the profile doc carries PII
    const uid = d.ref.parent.parent?.id;
    const phone = d.get('phoneNumber') as string | undefined;
    if (uid && phone && !out.has(phone)) out.set(phone, uid);
  }
  return out;
}

/** Single phone → uid (Phase B). Admin SDK only. */
export async function findUidByPhoneNumber(
  db: FirebaseFirestore.Firestore,
  e164: string,
): Promise<string | null> {
  const snap = await db.collectionGroup('private').where('phoneNumber', '==', e164).limit(1).get();
  for (const d of snap.docs) {
    if (d.id === 'profile') return d.ref.parent.parent?.id ?? null;
  }
  return null;
}
