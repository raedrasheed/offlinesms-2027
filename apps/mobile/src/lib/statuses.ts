// Status module data layer.
//
// Writes go through Cloud Function callables (createStatus / markStatusViewed)
// and the OTHERS' feed is fetched via getStatusFeed — the audience rules are
// per-document, so a client query over other users' statuses can never be
// proven safe. The caller's OWN statuses are the one provable query
// (authorId == uid), so those subscribe live; deletes are author-direct
// (allowed by firestore.rules).

import {
  collection, doc, onSnapshot, orderBy, query, where, limit, deleteDoc,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db, auth } from './firebase';
import type { StatusFeedItem } from './statusModel';

export type { StatusFeedItem, AuthorStatusGroup } from './statusModel';
export { groupStatusFeed } from './statusModel';

/** Solid backgrounds for text statuses — mirrors the server palette. */
export const STATUS_BG_COLORS = [
  '#075E54', '#128C7E', '#1F7BA8', '#5B3CC4',
  '#C2185B', '#D84315', '#37474F', '#7B1FA2',
] as const;

export const STATUS_BODY_MAX = 700;

export type MyStatus = {
  statusId:        string;
  body:            string;
  backgroundColor: string | null;
  viewCount:       number;
  createdAtMs:     number;
  expiresAtMs:     number;
};

function fn<T = unknown, R = unknown>(name: string) {
  return httpsCallable<T, R>(getFunctions(app), name);
}

export async function createTextStatus(args: {
  body: string;
  backgroundColor: string;
}): Promise<string> {
  const res = await fn<
    { type: 'text'; body: string; backgroundColor: string },
    { statusId: string; expiresAtMs: number }
  >('createStatus')({ type: 'text', ...args });
  return res.data.statusId;
}

export async function fetchStatusFeed(): Promise<StatusFeedItem[]> {
  const res = await fn<Record<string, never>, { items: StatusFeedItem[] }>('getStatusFeed')({});
  return res.data.items ?? [];
}

export async function markStatusViewed(statusId: string): Promise<void> {
  await fn<{ statusId: string }, { ok: true }>('markStatusViewed')({ statusId });
}

/** Author-direct delete — firestore.rules allows `authorId == uid`. */
export async function deleteStatus(statusId: string): Promise<void> {
  await deleteDoc(doc(db, 'statuses', statusId));
}

/** Live subscription to the caller's own active statuses, oldest → newest. */
export function subscribeMyStatuses(cb: (rows: MyStatus[]) => void) {
  const uid = auth.currentUser?.uid;
  if (!uid) { cb([]); return () => {}; }
  const q = query(
    collection(db, 'statuses'),
    where('authorId', '==', uid),
    orderBy('createdAt', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    snap => {
      const now = Date.now();
      const rows = snap.docs
        .map(d => {
          const s = d.data() as Record<string, any>;
          return {
            statusId:        d.id,
            body:            s.body ?? '',
            backgroundColor: s.backgroundColor ?? null,
            viewCount:       s.viewCount ?? 0,
            createdAtMs:     s.createdAt?.toMillis?.() ?? 0,
            expiresAtMs:     s.expiresAt?.toMillis?.() ?? 0,
          } as MyStatus;
        })
        .filter(s => s.expiresAtMs > now)
        .sort((a, b) => a.createdAtMs - b.createdAtMs);
      cb(rows);
    },
    err => { if (__DEV__) console.warn('[statuses] subscribeMyStatuses failed:', err); },
  );
}

/** Live viewer count for one of the caller's own statuses (owner-only read). */
export function subscribeStatusViewCount(statusId: string, cb: (count: number) => void) {
  return onSnapshot(
    collection(db, 'statuses', statusId, 'views'),
    snap => cb(snap.size),
    err => { if (__DEV__) console.warn('[statuses] subscribeStatusViewCount failed:', err); },
  );
}
