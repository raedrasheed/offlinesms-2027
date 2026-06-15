// Contact sync — reads device contacts (requires permission), normalizes
// phone numbers, and calls the `matchContacts` Cloud Function to find
// which of the user's contacts are already on OfflineSMS.

import * as Contacts from 'expo-contacts';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

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

function normalizeE164(raw: string, defaultCountry = '+1'): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return /^\+[1-9]\d{6,14}$/.test(digits) ? digits : null;
  if (/^\d{10,15}$/.test(digits)) return `${defaultCountry}${digits.replace(/^0+/, '')}`;
  return null;
}

export async function loadDeviceContactsAsE164(defaultCountry = '+1'): Promise<string[]> {
  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.PhoneNumbers],
    pageSize: 1000,
  });
  const out = new Set<string>();
  for (const c of data) {
    for (const p of c.phoneNumbers ?? []) {
      const n = normalizeE164(p.number ?? '', defaultCountry);
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
): Promise<ContactMatch[]> {
  const fn = httpsCallable<{ phones: string[] }, { matches: ContactMatch[] }>(
    getFunctions(app, 'us-central1'),
    'matchContacts',
  );

  const total = phones.length;
  onProgress?.({ scanned: 0, total, matched: 0 });

  // Call the server in batches so big contact lists don't exceed the per-call
  // cap; dedupe matches by uid (a person may appear under several numbers).
  const byUid = new Map<string, ContactMatch>();
  let scanned = 0;
  for (const batch of chunk(phones, PHONES_PER_CALL)) {
    const res = await fn({ phones: batch });
    for (const m of res.data.matches ?? []) byUid.set(m.uid, m);
    scanned += batch.length;
    onProgress?.({ scanned, total, matched: byUid.size });
  }

  return [...byUid.values()];
}
