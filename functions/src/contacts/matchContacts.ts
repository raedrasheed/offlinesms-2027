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
import { findUidsByPhoneNumbers } from '../lib/userPrivate';

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

  // F1 Phase B: resolve phone → uid via the private/profile collection group,
  // then read the PUBLIC user doc for the non-PII display fields.
  const phoneToUid = new Map<string, string>();   // phone → uid (excluding self)
  for (const batch of chunk(cleaned, FIRESTORE_IN_LIMIT)) {
    const found = await findUidsByPhoneNumbers(db, batch);
    for (const [phone, ownerUid] of found) {
      if (ownerUid !== uid) phoneToUid.set(phone, ownerUid);
    }
  }

  const uids = [...new Set(phoneToUid.values())];
  const profiles = new Map<string, { displayName: string; username: string | null }>();
  for (const ids of chunk(uids, 100)) {
    const snaps = await db.getAll(...ids.map(id => db.collection('users').doc(id)));
    for (const s of snaps) {
      if (!s.exists) continue;
      profiles.set(s.id, {
        displayName: (s.get('displayName') as string) ?? '',
        username:    (s.get('username') as string) ?? null,
      });
    }
  }

  for (const [phone, ownerUid] of phoneToUid) {
    const p = profiles.get(ownerUid);
    matches.push({
      uid:         ownerUid,
      displayName: p?.displayName ?? '',
      username:    p?.username ?? null,
      phoneE164:   phone,
    });
  }

  return { matches };
});
