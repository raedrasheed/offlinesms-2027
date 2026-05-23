// Match a list of E.164 phone numbers from a user's address book against
// registered OfflineSMS users. Returns only minimal public-profile fields
// so the caller can show a "found on OfflineSMS" list.
//
// SECURITY NOTES:
//   - Caller must be authenticated; we never expose user lookups to
//     unauthenticated requests.
//   - We only return uid, displayName, username, and the matched phone.
//     Never return raw email or any non-public fields.
//   - We cap the input list so callers can't enumerate the whole user
//     base by passing millions of numbers.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';

const MAX_PHONES_PER_CALL = 500;
const FIRESTORE_IN_LIMIT = 30;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export const matchContacts = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const phones = (request.data?.phones ?? []) as unknown;
  if (!Array.isArray(phones)) throw new HttpsError('invalid-argument', 'phones-must-be-array');

  const cleaned = (phones as unknown[])
    .filter((p): p is string => typeof p === 'string' && /^\+[1-9]\d{6,14}$/.test(p));
  if (cleaned.length === 0) return { matches: [] };
  if (cleaned.length > MAX_PHONES_PER_CALL) {
    throw new HttpsError('invalid-argument', 'too-many-phones');
  }

  const db = getFirestore();
  const matches: Array<{
    uid:         string;
    displayName: string;
    username:    string | null;
    phoneE164:   string;
  }> = [];

  for (const batch of chunk(cleaned, FIRESTORE_IN_LIMIT)) {
    const snap = await db.collection('users')
      .where('phoneNumber', 'in', batch)
      .select('displayName', 'username', 'phoneNumber')
      .get();
    for (const doc of snap.docs) {
      if (doc.id === uid) continue;
      const d = doc.data();
      matches.push({
        uid:         doc.id,
        displayName: (d.displayName as string) ?? '',
        username:    (d.username as string) ?? null,
        phoneE164:   d.phoneNumber as string,
      });
    }
  }

  return { matches };
});
