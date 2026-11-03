// Callable: the caller's status feed — every active (non-expired) status
// from OTHER users that the caller is in the audience of, plus whether the
// caller has already viewed each one.
//
// Reads must go through a callable: the audience rules in firestore.rules
// are per-document (`uid in excludedViewerUids` etc.) so a client-side
// collection query can never be proven safe ("rules are not filters").
// The caller's OWN statuses are not returned here — the client subscribes
// to those directly (the authorId == uid query IS provable).

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { isStatusAudienceMember, type StatusAudience } from './statusLogic';
import { cleanNameSnapshot, publicNameFrom } from '../lib/displayName';

const FEED_SCAN_MAX = 300; // newest active statuses scanned per request

export type StatusFeedItem = {
  statusId:        string;
  authorId:        string;
  authorName:      string;
  authorPhotoURL:  string | null;
  type:            'text' | 'image' | 'video';
  body:            string;
  mediaUrl:        string | null;
  durationMs:      number | null;
  backgroundColor: string | null;
  createdAtMs:     number;
  expiresAtMs:     number;
  viewedByMe:      boolean;
  likedByMe:       boolean;
  likeCount:       number;
  mentions:       { uid: string; name: string; username: string | null }[];
};

export const getStatusFeed = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const db = getFirestore();
  const now = Timestamp.now();
  const viewer = await db.doc(`users/${uid}`).get();
  if (!viewer.exists || (viewer.get('status') ?? 'active') !== 'active' || viewer.get('disabled') === true) throw new HttpsError('permission-denied', 'status-account-unavailable');

  // Single range query on expiresAt (auto single-field index); audience is
  // filtered in memory below since it can't be expressed as a query.
  const snap = await db.collection('statuses')
    .where('expiresAt', '>', now)
    .orderBy('expiresAt', 'desc')
    .limit(FEED_SCAN_MAX)
    .get();

  const candidates = snap.docs.filter(d => {
    const s = d.data() as {
      authorId?: string;
      audienceType?: StatusAudience;
      allowedViewerUids?: string[];
      excludedViewerUids?: string[];
    };
    if (s.authorId === uid) return false;            // own statuses excluded
    return isStatusAudienceMember(s, uid);
  });

  const authors = [...new Set(candidates.map(d => d.get('authorId')).filter((u): u is string => typeof u === 'string' && !!u && !u.includes('/')))];
  const authorData = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  const blocked = new Set<string>();
  for (let offset = 0; offset < authors.length; offset += 50) {
    const chunk = authors.slice(offset, offset + 50);
    const users = await db.getAll(...chunk.map(id => db.doc(`users/${id}`)));
    const blocks = await db.getAll(...chunk.flatMap(id => [db.doc(`users/${uid}/blockedUsers/${id}`), db.doc(`users/${id}/blockedUsers/${uid}`)]));
    chunk.forEach((id, i) => { authorData.set(id, users[i]); if (blocks[i * 2].exists || blocks[i * 2 + 1].exists) blocked.add(id); });
  }
  const visible = candidates.filter(d => {
    const id = d.get('authorId'), author = authorData.get(id);
    return author?.exists && (author.get('status') ?? 'active') === 'active' && author.get('disabled') !== true && !blocked.has(id);
  });

  // Which of these has the caller already viewed? (doc id = viewer uid)
  let viewedIds = new Set<string>();
  let likedIds = new Set<string>();
  if (visible.length > 0) {
    const viewRefs = visible.map(d => d.ref.collection('views').doc(uid));
    const viewSnaps = await db.getAll(...viewRefs);
    viewedIds = new Set(viewSnaps.filter(v => v.exists).map(v => v.ref.parent.parent!.id));
    const likes = await db.getAll(...visible.map(d => d.ref.collection('likes').doc(uid)));
    likedIds = new Set(likes.filter(v => v.exists).map(v => v.ref.parent.parent!.id));
  }

  // Live author names (one batched getAll for the distinct authors) so a
  // rename shows immediately; the stored authorName is only a fallback and a
  // uid is never returned as a name ('' → the client's translated fallback).
  const items: StatusFeedItem[] = visible.map(d => {
    const s = d.data() as Record<string, any>;
    const authorId = (s.authorId ?? '') as string;
    return {
      statusId:        d.id,
      authorId:        s.authorId ?? '',
      authorName:      publicNameFrom(authorData.get(authorId)?.data(), authorId) ?? cleanNameSnapshot(s.authorName, authorId) ?? '',
      authorPhotoURL:  authorData.get(authorId)?.get('photoURL') ?? s.authorPhotoURL ?? null,
      type:            (s.type === 'image' || s.type === 'video') ? s.type : 'text',
      body:            s.body ?? '',
      mediaUrl:        s.mediaUrl ?? null,
      durationMs:      s.durationMs ?? null,
      backgroundColor: s.backgroundColor ?? null,
      createdAtMs:     s.createdAt?.toMillis?.() ?? 0,
      expiresAtMs:     s.expiresAt?.toMillis?.() ?? 0,
      viewedByMe:      viewedIds.has(d.id),
      likedByMe:       likedIds.has(d.id),
      likeCount:       Math.max(0, Number(s.likeCount ?? 0)),
      mentions:       Array.isArray(s.mentions) ? s.mentions : [],
    };
  });

  // Newest first; the client groups per author.
  items.sort((a, b) => b.createdAtMs - a.createdAtMs);

  return { items };
});
