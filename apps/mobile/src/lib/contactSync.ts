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

export async function matchContactsOnServer(
  phones: string[],
  onProgress?: (p: SyncProgress) => void,
): Promise<ContactMatch[]> {
  const fn = httpsCallable<{ phones: string[] }, { matches: ContactMatch[] }>(
    getFunctions(app, 'us-central1'),
    'matchContacts',
  );
  // Server processes in batches; report optimistic progress while we wait.
  onProgress?.({ scanned: 0, total: phones.length, matched: 0 });
  const res = await fn({ phones });
  const matches = res.data.matches ?? [];
  onProgress?.({ scanned: phones.length, total: phones.length, matched: matches.length });
  return matches;
}
