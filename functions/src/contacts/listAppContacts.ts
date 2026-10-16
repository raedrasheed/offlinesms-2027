import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldPath, type Query } from 'firebase-admin/firestore';
import { publicNameFrom } from '../lib/displayName';
import { parseContact, type ContactAttachment } from '../chats/attachmentModel';

const PAGE_SIZE = 30;
type Cursor = { done: boolean; afterUid?: string; afterValue?: string };
type Part = { field: 'displayName' | 'usernameLower' | null; prefix: string };

/** Return a public-only projection even when legacy user documents contain PII. */
export const listAppContacts = onCall({ region: 'us-central1' }, async request => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const data = (request.data ?? {}) as { search?: unknown; cursor?: unknown };
  if (data.search !== undefined && (typeof data.search !== 'string' || data.search.length > 80)) {
    throw new HttpsError('invalid-argument', 'search-invalid');
  }
  const search = typeof data.search === 'string' ? data.search.trim() : '';
  const lower = search.toLowerCase();
  const prefixes = [...new Set([search, lower, lower.replace(/(^|\s)\S/g, s => s.toUpperCase())])];
  const parts: Part[] = search ? [
    ...(!search.startsWith('@') ? prefixes.map(prefix => ({ field: 'displayName' as const, prefix })) : []),
    { field: 'usernameLower', prefix: lower.replace(/^@/, '') },
  ] : [{ field: null, prefix: '' }];

  let cursor: Cursor[] = parts.map(() => ({done:false}));
  if (data.cursor !== undefined) {
    if (!Array.isArray(data.cursor) || data.cursor.length !== parts.length) throw new HttpsError('invalid-argument', 'cursor-invalid');
    cursor = data.cursor.map((raw: unknown, i: number) => {
      const c = raw as Partial<Cursor> | null;
      if (!c || typeof c.done !== 'boolean'
        || (c.afterUid !== undefined && (typeof c.afterUid !== 'string' || !c.afterUid || c.afterUid.length > 128 || /[\/\x00-\x1f\x7f]/.test(c.afterUid) || c.afterUid === '.' || c.afterUid === '..'))
        || (parts[i].field && c.afterUid && (typeof c.afterValue !== 'string' || c.afterValue.length > 1500))) {
        throw new HttpsError('invalid-argument', 'cursor-invalid');
      }
      return {done:c.done,...(c.afterUid ? {afterUid:c.afterUid,...(parts[i].field ? {afterValue:c.afterValue} : {})} : {})};
    });
  }
  const db = getFirestore();
  const contacts = new Map<string, ContactAttachment>();
  const next = await Promise.all(parts.map(async (part, i): Promise<Cursor> => {
    const position = cursor[i];
    if (position.done) return position;
    let q: Query = db.collection('users');
    if (part.field) {
      q = q.orderBy(part.field).orderBy(FieldPath.documentId())
        .where(part.field, '>=', part.prefix).where(part.field, '<=', part.prefix + '\uf8ff');
      if (position.afterUid) q = q.startAfter(position.afterValue, position.afterUid);
    } else {
      q = q.orderBy(FieldPath.documentId());
      if (position.afterUid) q = q.startAfter(position.afterUid);
    }
    // The client SDK cannot project fields. Never fetch or return legacy PII.
    const snapshot = await q.select('displayName','username','usernameLower','status').limit(PAGE_SIZE).get();
    for (const row of snapshot.docs) {
      if ((row.get('status') ?? 'active') !== 'active') continue;
      const contact = parseContact({ uid:row.id,
        name:(publicNameFrom(row.data(), row.id) || 'OfflineSMS').slice(0,160), username:row.get('username'),
      });
      if (contact?.uid) contacts.set(contact.uid,contact);
    }
    const last = snapshot.docs[snapshot.docs.length - 1];
    return {done:snapshot.size < PAGE_SIZE,...(last ? {afterUid:last.id,...(part.field ? {afterValue:last.get(part.field) as string} : {})} : {})};
  }));
  return {contacts:[...contacts.values()],page:{cursor:next,hasMore:next.some(c => !c.done)}};
});
