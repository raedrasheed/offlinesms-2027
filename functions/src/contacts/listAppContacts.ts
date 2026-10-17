import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldPath, type Query } from 'firebase-admin/firestore';
import type { ContactAttachment } from '../chats/attachmentModel';
import { findUidsByPhoneNumbers } from '../lib/userPrivate';
import { CONTACT_SEARCH_VERSION, PUBLIC_CONTACT_FIELDS, contactMatches, normalizeContactSearch, publicAppContact } from './contactSearch';

const PAGE_SIZE = 30;
const SEARCH_BATCH = 100;
type Cursor = { done:boolean; afterUid?:string; query?:string };
const validId = (v:unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1500 && !/[\/\x00-\x1f\x7f]/.test(v) && v !== '.' && v !== '..';

/** Empty search = the caller's contacts. Typed search = public substring matches. */
export const listAppContacts = onCall({region:'us-central1'}, async request => {
  const me=request.auth?.uid;
  if (!me) throw new HttpsError('unauthenticated','sign-in-required');
  const data=(request.data ?? {}) as {search?:unknown;cursor?:unknown};
  if (data.search !== undefined && (typeof data.search !== 'string' || data.search.length > 80)) {
    throw new HttpsError('invalid-argument','search-invalid');
  }
  const raw=typeof data.search === 'string' ? data.search.trim() : '';
  const term=normalizeContactSearch(raw.replace(/^@/,''));
  const search=term ? `${raw.startsWith('@') ? '@' : ''}${term}` : '';
  const scope=search ? 'search' : 'account';
  const key=`${scope}:${search}`;
  let cursor:Cursor[]=Array.from({length:search ? 1 : 2},()=>({done:false,query:key}));
  if (data.cursor !== undefined) {
    if (!Array.isArray(data.cursor) || data.cursor.length !== cursor.length) throw new HttpsError('invalid-argument','cursor-invalid');
    cursor=data.cursor.map((c:unknown) => {
      const v=c as Cursor | null;
      if (!v || typeof v.done !== 'boolean' || (v.afterUid !== undefined && !validId(v.afterUid)) ||
        (v.query !== undefined && v.query !== key)) throw new HttpsError('invalid-argument','cursor-invalid');
      return {done:v.done,query:key,...(v.afterUid ? {afterUid:v.afterUid} : {})};
    });
  }
  const db=getFirestore();
  const contacts=new Map<string,ContactAttachment>();
  async function profiles(uids:Iterable<string>) {
    const ids=[...new Set(uids)].filter(uid=>uid !== me && validId(uid) && uid.length<=128);
    if (!ids.length) return [];
    const rows=await db.getAll(...ids.map(uid=>db.doc(`users/${uid}`)),{fieldMask:PUBLIC_CONTACT_FIELDS});
    return rows.map(row=>publicAppContact(row.id,row.exists ? row.data() : undefined)).filter((c):c is ContactAttachment=>!!c?.uid);
  }

  if (search) {
    const ready=await db.doc('appContactSearchMeta/state').get();
    if (ready.get('version') !== CONTACT_SEARCH_VERSION || ready.get('ready') !== true) {
      throw new HttpsError('failed-precondition','contact-search-not-ready');
    }
    const position=cursor[0];
    if (!position.done) {
      const gram=Array.from(term).slice(0,3).join('');
      let q:Query=db.collection('appContactSearch').where('terms','array-contains',gram).orderBy(FieldPath.documentId());
      if (position.afterUid) q=q.startAfter(position.afterUid);
      const rows=await q.select('name','username').limit(SEARCH_BATCH).get();
      const candidates=rows.docs.filter(row=>contactMatches({name:row.get('name') ?? '',username:row.get('username'),phones:[],emails:[]},search));
      // Revalidate live profiles: delayed delete/suspend/rename triggers cannot return stale results.
      const live=new Map((await profiles(candidates.map(row=>row.id))).map(c=>[c.uid!,c]));
      let consumed=0;
      for (const row of rows.docs) {
        consumed++; position.afterUid=row.id;
        const contact=live.get(row.id);
        if (contact && contactMatches(contact,search)) contacts.set(row.id,contact);
        if (contacts.size===PAGE_SIZE) break;
      }
      position.done=consumed===rows.size && rows.size<SEARCH_BATCH;
    }
  } else {
    const uids=new Set<string>();
    if (!cursor[0].done) {
      let q:Query=db.collection('phoneContacts').where('ownerUid','==',me).orderBy(FieldPath.documentId());
      if (cursor[0].afterUid) q=q.startAfter(cursor[0].afterUid);
      const rows=await q.select('phoneE164','linkedUid').limit(PAGE_SIZE).get();
      const phones=[...new Set(rows.docs.map(row=>row.get('phoneE164')).filter((v):v is string=>typeof v==='string' && /^\+[1-9]\d{6,14}$/.test(v)))];
      const matches=await findUidsByPhoneNumbers(db,phones);
      for (const row of rows.docs) {
        const phone=row.get('phoneE164');
        // Resolve saved numbers again; stale links must not point at a former phone owner.
        const uid=typeof phone==='string' && /^\+[1-9]\d{6,14}$/.test(phone) ? matches.get(phone) : row.get('linkedUid');
        if (validId(uid)) uids.add(uid);
      }
      cursor[0]={done:rows.size<PAGE_SIZE,query:key,...(rows.size ? {afterUid:rows.docs[rows.size-1].id} : {})};
    }
    if (!cursor[1].done) {
      let q:Query=db.collection('conversations').where('participantUids','array-contains',me).orderBy(FieldPath.documentId());
      if (cursor[1].afterUid) q=q.startAfter(cursor[1].afterUid);
      const rows=await q.select('type','participantUids','status').limit(PAGE_SIZE).get();
      for (const row of rows.docs) {
        const members=row.get('participantUids');
        if (!Array.isArray(members) || members.length!==2 || (row.get('type') ?? 'direct')!=='direct' || (row.get('status') ?? 'active')!=='active') continue;
        for (const uid of members) if (uid!==me && validId(uid)) uids.add(uid);
      }
      cursor[1]={done:rows.size<PAGE_SIZE,query:key,...(rows.size ? {afterUid:rows.docs[rows.size-1].id} : {})};
    }
    for (const contact of await profiles(uids)) contacts.set(contact.uid!,contact);
  }
  return {schemaVersion:2,scope,contacts:[...contacts.values()],page:{cursor,hasMore:cursor.some(c=>!c.done)}};
});
