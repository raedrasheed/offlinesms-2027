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
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, db, auth, storage } from './firebase';
import type { StatusFeedItem, StatusType, StatusMention } from './statusModel';

export type { StatusFeedItem, StatusType, AuthorStatusGroup } from './statusModel';
export { groupStatusFeed } from './statusModel';

/** Solid backgrounds for text statuses — mirrors the server palette. */
export const STATUS_BG_COLORS = [
  '#075E54', '#128C7E', '#1F7BA8', '#5B3CC4',
  '#C2185B', '#D84315', '#37474F', '#7B1FA2',
] as const;

export const STATUS_BODY_MAX = 700;

// Media caps — mirror functions/src/statuses/statusLogic.ts + storage.rules.
export const STATUS_MEDIA_MAX_BYTES = 15 * 1024 * 1024;
export const STATUS_VIDEO_MAX_MS    = 30_000;

export type MyStatus = {
  statusId:        string;
  type:            StatusType;
  body:            string;
  mediaUrl:        string | null;
  durationMs:      number | null;
  backgroundColor: string | null;
  viewCount:       number;
  createdAtMs:     number;
  expiresAtMs:     number;
  mentions:       StatusMention[];
  likeCount:      number;
};

function fn<T = unknown, R = unknown>(name: string) {
  return httpsCallable<T, R>(getFunctions(app), name);
}

export async function createTextStatus(args: {
  body: string;
  backgroundColor: string;
  mentionUids?: string[];
}): Promise<string> {
  const res = await fn<
    { type: 'text'; body: string; backgroundColor: string; mentionUids?: string[] },
    { statusId: string; expiresAtMs: number }
  >('createStatus')({ type: 'text', ...args });
  return res.data.statusId;
}

/**
 * Post an image/video status: upload the binary to the caller's own
 * statuses/{uid}/ folder (storage.rules: owner-only, ≤15MB, image/video
 * MIME), then register it via the createStatus callable. sizeBytes is
 * taken from the uploaded blob — the picker's fileSize is unreliable.
 */
export async function createMediaStatus(args: {
  localUri:   string;
  type:       'image' | 'video';
  mimeType:   string;
  caption?:   string;
  durationMs?: number | null;
  mentionUids?: string[];
}): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('sign-in-required');

  const res = await fetch(args.localUri);
  const blob = await res.blob();
  if (blob.size > STATUS_MEDIA_MAX_BYTES) throw new Error('size-invalid');

  const ext = args.mimeType.split('/')[1]?.replace('quicktime', 'mov') ?? 'bin';
  const storagePath = `statuses/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const r = ref(storage, storagePath);
  await uploadBytes(r, blob, { contentType: args.mimeType });
  const mediaUrl = await getDownloadURL(r);

  const out = await fn<Record<string, unknown>, { statusId: string; expiresAtMs: number }>('createStatus')({
    type:        args.type,
    body:        args.caption ?? '',
    mediaUrl,
    storagePath,
    mimeType:    args.mimeType,
    sizeBytes:   blob.size,
    durationMs:  args.type === 'video' ? args.durationMs ?? null : null,
    mentionUids: args.mentionUids ?? [],
  });
  return out.data.statusId;
}

let cachedUid = '', cachedAt = 0, cachedFeed: StatusFeedItem[] = [];
let pending: Promise<StatusFeedItem[]> | null = null;
const feedListeners = new Set<() => void>();
export function subscribeStatusFeedChanges(listener: () => void) { feedListeners.add(listener); return () => { feedListeners.delete(listener); }; }
export function peekStatusFeed(): StatusFeedItem[] {
  return cachedUid === auth.currentUser?.uid ? cachedFeed.filter(s => s.expiresAtMs > Date.now()) : [];
}
export async function fetchStatusFeed(force = false): Promise<StatusFeedItem[]> {
  const uid = auth.currentUser?.uid ?? '';
  if (!uid) return [];
  if (cachedUid !== uid) { cachedUid = uid; cachedAt = 0; cachedFeed = []; pending = null; }
  if (!force && cachedAt > Date.now() - 15_000) return peekStatusFeed();
  if (pending) return pending;
  const request = fn<Record<string, never>, { items: StatusFeedItem[] }>('getStatusFeed')({}).then(res => {
    if (cachedUid !== uid || auth.currentUser?.uid !== uid) return [];
    cachedFeed = res.data.items ?? []; cachedAt = Date.now(); feedListeners.forEach(fn => fn());
    return peekStatusFeed();
  }).finally(() => { if (pending === request) pending = null; });
  pending = request;
  return request;
}

export async function markStatusViewed(statusId: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  await fn<{ statusId: string }, { ok: true }>('markStatusViewed')({ statusId });
  if (!uid || auth.currentUser?.uid !== uid || cachedUid !== uid) return;
  cachedFeed = cachedFeed.map(s => s.statusId === statusId ? { ...s, viewedByMe: true } : s);
  feedListeners.forEach(listener => listener());
}

export async function setStatusLike(statusId: string, liked: boolean) {
  const uid = auth.currentUser?.uid;
  const res = await fn<{ statusId: string; liked: boolean }, { liked: boolean; likeCount: number }>('setStatusLike')({ statusId, liked });
  if (!uid || auth.currentUser?.uid !== uid || cachedUid !== uid) return res.data;
  cachedFeed = cachedFeed.map(s => s.statusId === statusId ? { ...s, likedByMe: res.data.liked, likeCount: res.data.likeCount } : s);
  feedListeners.forEach(listener => listener());
  return res.data;
}
export type StatusViewerProfile = { uid: string; name: string; photoURL: string | null; viewedAtMs: number; liked: boolean };
export async function listStatusViewers(statusId: string, after?: string) {
  const res = await fn<{ statusId: string; after?: string }, { viewers: StatusViewerProfile[]; next: string | null }>('listStatusViewers')({ statusId, ...(after ? { after } : {}) });
  return res.data;
}
export async function replyToStatus(statusId: string, text: string, localId: string) {
  const res = await fn<{ statusId: string; text: string; localId: string }, { conversationId: string; messageId: string }>('replyToStatus')({ statusId, text, localId });
  return res.data;
}
export async function getStatus(statusId: string) {
  const res = await fn<{ statusId: string }, { item: StatusFeedItem; isMine: boolean }>('getStatus')({ statusId });
  return res.data;
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
            type:            (s.type === 'image' || s.type === 'video') ? s.type : 'text',
            body:            s.body ?? '',
            mediaUrl:        s.mediaUrl ?? null,
            durationMs:      s.durationMs ?? null,
            backgroundColor: s.backgroundColor ?? null,
            viewCount:       s.viewCount ?? 0,
            createdAtMs:     s.createdAt?.toMillis?.() ?? 0,
            expiresAtMs:     s.expiresAt?.toMillis?.() ?? 0,
            mentions:       Array.isArray(s.mentions) ? s.mentions : [],
            likeCount:      s.likeCount ?? 0,
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
