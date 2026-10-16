import {
  collection, documentId, getDocs, limit, orderBy, query, startAfter, where,
  type QueryDocumentSnapshot, type QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';
import { displayNameFor, normalizeProfile } from './displayNames.pure';
import { parseContact, type ContactAttachment } from '../media/attachmentModel';

export type AppContact = ContactAttachment & { uid: string };
type SearchPart = { field: 'displayName' | 'usernameLower' | null; prefix: string; cursor?: QueryDocumentSnapshot; done: boolean };
export type ContactPage = { parts: SearchPart[]; hasMore: boolean };
const PAGE_SIZE = 30;

/** Only the public users collection is read. No address-book or private-profile access. */
export async function loadAppContacts(term: string, page?: ContactPage): Promise<{ contacts: AppContact[]; page: ContactPage }> {
  const text = term.trim().slice(0, 80);
  // Existing profiles have no lower-case display-name index. Query the entered
  // prefix plus common letter-case variants, alongside the normalized username.
  const prefixes = [...new Set([text, text.toLowerCase(), text.replace(/(^|\s)\S/g, s => s.toUpperCase())])];
  const parts: SearchPart[] = page?.parts ?? (text ? [
    ...(!text.startsWith('@') ? prefixes.map(prefix => ({ field: 'displayName' as const, prefix, done: false })) : []),
    { field: 'usernameLower', prefix: text.replace(/^@/, '').toLowerCase(), done: false },
  ] : [{ field: null, prefix: '', done: false }]);
  const contacts = new Map<string, AppContact>();
  const next = await Promise.all(parts.map(async part => {
    if (part.done) return part;
    const constraints: QueryConstraint[] = [orderBy(part.field ?? documentId())];
    if (part.field) constraints.push(where(part.field, '>=', part.prefix), where(part.field, '<=', part.prefix + '\uf8ff'));
    if (part.cursor) constraints.push(startAfter(part.cursor));
    constraints.push(limit(PAGE_SIZE));
    const snapshot = await getDocs(query(collection(db, 'users'), ...constraints));
    for (const row of snapshot.docs) {
      const raw = row.data();
      if ((raw.status ?? 'active') !== 'active') continue;
      const profile = normalizeProfile(raw);
      const contact = parseContact({ uid: row.id,
        name: displayNameFor(profile, { uid: row.id, fallback: 'OfflineSMS' }).slice(0, 160),
        username: profile.username,
      });
      if (contact?.uid) contacts.set(contact.uid, contact as AppContact);
    }
    return { ...part, cursor: snapshot.docs[snapshot.docs.length - 1] ?? part.cursor, done: snapshot.size < PAGE_SIZE };
  }));
  return { contacts: [...contacts.values()], page: { parts: next, hasMore: next.some(p => !p.done) } };
}

export function mergeAppContacts(current: AppContact[], incoming: AppContact[]): AppContact[] {
  const unique = new Map(current.map(contact => [contact.uid, contact]));
  incoming.forEach(contact => unique.set(contact.uid, contact));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, ['ar', 'en'], { sensitivity: 'base' }) || a.uid.localeCompare(b.uid));
}
