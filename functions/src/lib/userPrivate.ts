// Sensitive user PII at rest (F1).
//
// A user's sensitive fields live in an owner/admin-only subdocument
// `users/{uid}/userPrivate/profile`. Phase A dual-writes here while the public
// `users/{uid}` doc still carries the same fields (removed only in Phase C);
// Phase B reads from here. The collection-group id is intentionally specific
// (`userPrivate`, not a generic `private`) so collectionGroup() queries can
// never collide with an unrelated subcollection elsewhere in the tree.
//
// Rules (firestore.rules): users/{uid}/userPrivate/{doc} is readable/writable
// only by the owner or an admin, so the PII is not exposed to other users.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/** Collection-group id for the private PII subcollection. Keep in sync with
 *  firestore.rules, firestore.indexes.json, and the non-backend copies
 *  (mobile pin.ts, dashboard orgMessagingService.ts, scripts) — those packages
 *  deploy separately and cannot import this constant. */
export const USER_PRIVATE_COLLECTION = 'userPrivate';
export const USER_PRIVATE_DOC = 'profile';

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
  return db.collection('users').doc(uid).collection(USER_PRIVATE_COLLECTION).doc(USER_PRIVATE_DOC);
}

/**
 * Phase A dual-write: merge the given sensitive fields into
 * users/{uid}/userPrivate/profile (+ updatedAt). Idempotent (merge). Only keys
 * that are explicitly provided (including explicit null) are written;
 * `undefined` keys are skipped so we never clobber an existing value.
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
 * Read a user's phone (Phase B): userPrivate/profile first; if absent (e.g. a
 * user created before the Phase A backfill ran), fall back to the still-present
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
 * Resolve phone E.164 → uid via the userPrivate/profile collection group
 * (Phase B discovery). Pass ≤ Firestore's `in` limit (callers chunk). Admin SDK
 * only; requires the COLLECTION_GROUP index on userPrivate.phoneNumber.
 */
export async function findUidsByPhoneNumbers(
  db: FirebaseFirestore.Firestore,
  phones: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (phones.length === 0) return out;
  const snap = await db.collectionGroup(USER_PRIVATE_COLLECTION).where('phoneNumber', 'in', phones).get();
  for (const d of snap.docs) {
    if (d.id !== USER_PRIVATE_DOC) continue;            // only the profile doc carries PII
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
  const snap = await db.collectionGroup(USER_PRIVATE_COLLECTION).where('phoneNumber', '==', e164).limit(1).get();
  for (const d of snap.docs) {
    if (d.id === USER_PRIVATE_DOC) return d.ref.parent.parent?.id ?? null;
  }
  return null;
}
