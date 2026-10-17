import { publicNameFrom } from '../lib/displayName';
import { parseContact, type ContactAttachment } from '../chats/attachmentModel';

export const CONTACT_SEARCH_VERSION = 1;
export const PUBLIC_CONTACT_FIELDS = ['displayName', 'username', 'usernameLower', 'status'];

/** Case/diacritic-insensitive contains search, including Arabic tatweel/harakat. */
export function normalizeContactSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ـ/g, '')
    .toLowerCase().replace(/\s+/gu, ' ').trim();
}

export function publicAppContact(uid: string, profile: Record<string, unknown> | undefined): ContactAttachment | null {
  if (!profile || (profile.status ?? 'active') !== 'active') return null;
  const username=profile.usernameLower || profile.username;
  return parseContact({ uid, name:(publicNameFrom(profile, uid) || 'OfflineSMS').slice(0,160),
    username:typeof username==='string' ? username.trim().replace(/^@/,'').toLowerCase() : undefined });
}

export function contactMatches(contact: ContactAttachment, search: string): boolean {
  const usernameOnly = search.trim().startsWith('@');
  const term = normalizeContactSearch(search.trim().replace(/^@/, ''));
  return !term || normalizeContactSearch(contact.username ?? '').includes(term) ||
    (!usernameOnly && normalizeContactSearch(contact.name).includes(term));
}

/** Bounded 1/2/3-character grams; long queries are verified against the full name. */
export function contactSearchDocument(uid: string, profile: Record<string, unknown> | undefined) {
  const contact = publicAppContact(uid, profile);
  if (!contact) return null;
  const terms = new Set<string>();
  for (const value of [contact.name, contact.username ?? '']) {
    const chars = Array.from(normalizeContactSearch(value));
    for (let size=1;size<=3;size++) for (let i=0;i+size<=chars.length;i++) {
      const gram=chars.slice(i,i+size).join('');
      if (gram.trim()) terms.add(gram);
    }
  }
  return { name:contact.name, ...(contact.username ? {username:contact.username} : {}),
    terms:[...terms].sort(), version:CONTACT_SEARCH_VERSION };
}
