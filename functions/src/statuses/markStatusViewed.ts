// Callable: record that the caller has viewed a status.
//
// Re-runs the Phase 3 audience check server-side before recording. The
// viewer doc id is the viewer's uid, so the same viewer can't accidentally
// double-count themselves. Self-views (the author viewing their own
// status) are silently no-op'd.
//
// Not audited: status views are too noisy.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { isStatusAudienceMember, type StatusAudience as Audience } from './statusLogic';

export const markStatusViewed = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as { statusId?: unknown };
  if (typeof data.statusId !== 'string' || !data.statusId)
    throw new HttpsError('invalid-argument', 'statusId-required');

  const db = getFirestore();
  const statusRef = db.collection('statuses').doc(data.statusId);
  const statusSnap = await statusRef.get();
  if (!statusSnap.exists) throw new HttpsError('not-found', 'status-not-found');

  const s = statusSnap.data() as {
    authorId?: string;
    audienceType?: Audience;
    allowedViewerUids?: string[];
    excludedViewerUids?: string[];
    expiresAt?: Timestamp | null;
  };

  // Author viewing own status — no-op.
  if (s.authorId === uid) {
    return { ok: true, applied: false, reason: 'self-view' };
  }

  // Expiry check.
  const expMs = s.expiresAt?.toMillis?.() ?? 0;
  if (expMs > 0 && Date.now() > expMs) {
    throw new HttpsError('failed-precondition', 'status-expired');
  }

  // Audience check (Phase 3 rules mirrored server-side).
  if (!isStatusAudienceMember(s, uid)) {
    throw new HttpsError('permission-denied', 'not-in-audience');
  }

  const viewRef = statusRef.collection('views').doc(uid);
  const viewSnap = await viewRef.get();
  if (viewSnap.exists) {
    return { ok: true, applied: false, reason: 'already-viewed' };
  }

  const batch = db.batch();
  batch.set(viewRef, {
    statusId:  data.statusId,
    ownerUid:  s.authorId ?? null,
    viewerUid: uid,
    viewedAt:  FieldValue.serverTimestamp(),
  });
  // First view per viewer (doc id = uid) — keep the aggregate on the parent.
  batch.update(statusRef, { viewCount: FieldValue.increment(1) });
  await batch.commit();

  return { ok: true, applied: true };
});
