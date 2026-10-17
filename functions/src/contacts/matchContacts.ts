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
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { findUidsByPhoneNumbers } from '../lib/userPrivate';
import { newPhoneContactDoc } from './contactLogic';
import { PUBLIC_CONTACT_FIELDS, publicAppContact } from './contactSearch';

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
  const saveMatches=request.data?.saveMatches === true;

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

  // F1 Phase B: resolve phone → uid via the userPrivate/profile collection group,
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
    const snaps = await db.getAll(...ids.map(id => db.collection('users').doc(id)), {fieldMask:PUBLIC_CONTACT_FIELDS});
    for (const s of snaps) {
      const contact=publicAppContact(s.id,s.exists ? s.data() : undefined);
      if (!contact) continue;
      profiles.set(s.id, {
        displayName: contact.name,
        username:    contact.username ?? null,
      });
    }
  }

  for (const [phone, ownerUid] of phoneToUid) {
    const p = profiles.get(ownerUid);
    if (!p) continue;
    matches.push({
      uid:         ownerUid,
      displayName: p?.displayName ?? '',
      username:    p?.username ?? null,
      phoneE164:   phone,
    });
  }

  // The explicit Find Friends sync saves only matched accounts, never the entire address book.
  // Older read-only callers retain their existing behavior by omitting saveMatches.
  if (saveMatches && matches.length) {
    const docs=matches.map(m=>newPhoneContactDoc({ownerUid:uid,displayName:m.displayName,e164:m.phoneE164,linkedUid:m.uid}));
    const refs=docs.map(d=>db.collection('phoneContacts').doc(d.contactId));
    await db.runTransaction(async tx=>{
      const existing=await tx.getAll(...refs,{fieldMask:['contactId']});
      docs.forEach((d,i)=>{
        // Existing aliases, organization metadata and creation time belong to the owner.
        if(existing[i].exists) tx.update(refs[i],{
          isRegistered:true,linkedUid:d.linkedUid,updatedAt:FieldValue.serverTimestamp(),
        });
        else tx.create(refs[i],{
          ...d,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
        });
      });
    });
  }

  return { matches };
});
