// Contact sync — reads device contacts (requires permission), normalizes
// phone numbers, and calls the `matchContacts` Cloud Function to find
// which of the user's contacts are already on OfflineSMS.

import * as Contacts from 'expo-contacts';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';
import { normalizePhoneToE164 } from './phone';

export type ContactMatch = {
  uid:         string;
  displayName: string;
  username?:   string | null;
  phoneE164:   string;
};

export type SyncProgress = {
  scanned: number;
  total:   number;
  matched: number;
};

// App is Palestine-scoped, so a device contact stored without a country code is
// Palestinian — default to +970 (never the device region, which may be +1). The
// shared normalizer leaves numbers that already carry a country code or "+"
// untouched, so foreign contacts match correctly too.
export async function loadDeviceContactsAsE164(defaultCountry = '+970'): Promise<string[]> {
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers],
    pageSize: 1000,
  });
  const out = new Set<string>();
  for (const c of data) {
    for (const p of c.phoneNumbers ?? []) {
      const n = normalizePhoneToE164(p.number ?? '', defaultCountry);
      if (n) out.add(n);
    }
  }
  return [...out];
}

// Server caps each call at 500 phones (matchContacts → 'too-many-phones').
// Stay safely under it and walk large address books in batches.
const PHONES_PER_CALL = 300;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function matchContactsOnServer(
  phones: string[],
  onProgress?: (p: SyncProgress) => void,
  onMatches?: (matches: ContactMatch[]) => void,
): Promise<ContactMatch[]> {
  const fn = httpsCallable<{ phones: string[]; saveMatches:boolean }, { matches: ContactMatch[] }>(
    getFunctions(app, 'us-central1'),
    'matchContacts',
  );

  const total = phones.length;
  onProgress?.({ scanned: 0, total, matched: 0 });

  // Call the server in batches so big contact lists don't exceed the per-call
  // cap; dedupe matches by uid (a person may appear under several numbers) and
  // stream the cumulative list out after each batch so found friends appear
  // progressively instead of all at the end.
  const byUid = new Map<string, ContactMatch>();
  let scanned = 0;
  for (const batch of chunk(phones, PHONES_PER_CALL)) {
    const res = await fn({ phones: batch, saveMatches:true });
    let added = false;
    for (const m of res.data.matches ?? []) {
      if (!byUid.has(m.uid)) { byUid.set(m.uid, m); added = true; }
    }
    scanned += batch.length;
    onProgress?.({ scanned, total, matched: byUid.size });
    if (added) onMatches?.([...byUid.values()]);
  }

  return [...byUid.values()];
}
