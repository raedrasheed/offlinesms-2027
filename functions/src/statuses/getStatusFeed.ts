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
};

export const getStatusFeed = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const db = getFirestore();
  const now = Timestamp.now();

  // Single range query on expiresAt (auto single-field index); audience is
  // filtered in memory below since it can't be expressed as a query.
  const snap = await db.collection('statuses')
    .where('expiresAt', '>', now)
    .orderBy('expiresAt', 'desc')
    .limit(FEED_SCAN_MAX)
    .get();

  const visible = snap.docs.filter(d => {
    const s = d.data() as {
      authorId?: string;
      audienceType?: StatusAudience;
      allowedViewerUids?: string[];
      excludedViewerUids?: string[];
    };
    if (s.authorId === uid) return false;            // own statuses excluded
    return isStatusAudienceMember(s, uid);
  });

  // Which of these has the caller already viewed? (doc id = viewer uid)
  let viewedIds = new Set<string>();
  if (visible.length > 0) {
    const viewRefs = visible.map(d => d.ref.collection('views').doc(uid));
    const viewSnaps = await db.getAll(...viewRefs);
    viewedIds = new Set(viewSnaps.filter(v => v.exists).map(v => v.ref.parent.parent!.id));
  }

  const items: StatusFeedItem[] = visible.map(d => {
    const s = d.data() as Record<string, any>;
    return {
      statusId:        d.id,
      authorId:        s.authorId ?? '',
      authorName:      s.authorName ?? s.authorId ?? '?',
      authorPhotoURL:  s.authorPhotoURL ?? null,
      type:            (s.type === 'image' || s.type === 'video') ? s.type : 'text',
      body:            s.body ?? '',
      mediaUrl:        s.mediaUrl ?? null,
      durationMs:      s.durationMs ?? null,
      backgroundColor: s.backgroundColor ?? null,
      createdAtMs:     s.createdAt?.toMillis?.() ?? 0,
      expiresAtMs:     s.expiresAt?.toMillis?.() ?? 0,
      viewedByMe:      viewedIds.has(d.id),
    };
  });

  // Newest first; the client groups per author.
  items.sort((a, b) => b.createdAtMs - a.createdAtMs);

  return { items };
});
