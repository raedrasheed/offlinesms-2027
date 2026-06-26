// Callable: createPhoneContact — create (or upsert) a private, phone-only
// contact for the caller. No Firebase Auth user is created. If a registered
// user already exists with the same phone, the contact is created already
// linked (isRegistered:true, linkedUid) so the UI badges it correctly.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';
import { normalizePhoneToE164 } from '../lib/phone';
import { newPhoneContactDoc, cleanDisplayName } from './contactLogic';
import { findUidByPhoneNumber } from '../lib/userPrivate';

/** Find a registered user by E.164 phone; returns uid or null.
 *  F1 Phase B: resolves via the userPrivate/profile collection group. */
export async function findRegisteredUidByPhone(e164: string): Promise<string | null> {
  return findUidByPhoneNumber(getFirestore(), e164);
}

export const createPhoneContact = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { displayName?: unknown; phoneNumber?: unknown; defaultCountry?: unknown };
  const displayName = cleanDisplayName(data.displayName);
  if (!displayName) throw new HttpsError('invalid-argument', 'name-required');

  const defaultCountry = typeof data.defaultCountry === 'string' ? data.defaultCountry : undefined;
  const e164 = typeof data.phoneNumber === 'string' ? normalizePhoneToE164(data.phoneNumber, defaultCountry) : null;
  if (!e164) throw new HttpsError('invalid-argument', 'phone-invalid');

  const organizationId = (request.auth?.token?.organizationId as string | undefined) ?? null;
  const linkedUid = await findRegisteredUidByPhone(e164);

  const docData = newPhoneContactDoc({ ownerUid: uid, organizationId, displayName, e164, linkedUid });
  const db = getFirestore();
  const ref = db.collection('phoneContacts').doc(docData.contactId);

  // Upsert (deterministic id = owner + phone) → re-adding the same number just
  // refreshes the name, never creates a duplicate variant.
  const existed = (await ref.get()).exists;
  await ref.set({
    ...docData,
    ...(existed ? {} : { createdAt: FieldValue.serverTimestamp() }),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  void writeAuditLog({
    action: existed ? 'contact.updated' : 'contact.created',
    actor: { uid },
    target: { type: 'phoneContact', id: docData.contactId },
    result: 'success',
    metadata: { isRegistered: docData.isRegistered },
  }).catch(() => {});

  return {
    contactId:   docData.contactId,
    phoneE164:   e164,
    displayName,
    isRegistered: docData.isRegistered,
    linkedUid:   docData.linkedUid,
    created:     !existed,
  };
});
