// Callable: record that the caller has viewed a status.
//
// Re-runs the Phase 3 audience check server-side before recording. The
// viewer doc id is the viewer's uid, so the same viewer can't accidentally
// double-count themselves. Self-views (the author viewing their own
// status) are silently no-op'd.
//
// Not audited: status views are too noisy.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { assertStatusAccess, statusIdInput } from './statusAccess';
import { isStatusAudienceMember } from './statusLogic';

export const markStatusViewed = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const statusId = statusIdInput(request.data?.statusId);

  const db = getFirestore();
  const statusRef = db.collection('statuses').doc(statusId);
  const statusSnap = await statusRef.get();
  if (!statusSnap.exists) throw new HttpsError('not-found', 'status-not-found');

  const s = statusSnap.data()!;
  await assertStatusAccess(db, uid, s);

  // Author viewing own status — no-op.
  if (s.authorId === uid) {
    return { ok: true, applied: false, reason: 'self-view' };
  }

  const viewRef = statusRef.collection('views').doc(uid);
  return db.runTransaction(async tx => {
    const [fresh, view] = await Promise.all([tx.get(statusRef), tx.get(viewRef)]);
    if (!fresh.exists) throw new HttpsError('not-found', 'status-not-found');
    if ((fresh.get('expiresAt')?.toMillis?.() ?? 0) <= Date.now()) throw new HttpsError('failed-precondition', 'status-expired');
    if (fresh.get('authorId') !== s.authorId || !isStatusAudienceMember(fresh.data()!, uid)) throw new HttpsError('permission-denied', 'not-in-audience');
    if (view.exists) return { ok: true, applied: false, reason: 'already-viewed' };
    tx.set(viewRef, { statusId, ownerUid: s.authorId, viewerUid: uid, viewedAt: FieldValue.serverTimestamp() });
    tx.update(statusRef, { viewCount: FieldValue.increment(1) });
    return { ok: true, applied: true };
  });
});
