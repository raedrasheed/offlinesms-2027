import { writeSocialActivity } from '../social/activityModel';
import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { clipId, cleanClipText, type ClipDoc } from './model';
import { requireClipUid, assertClipMutation, assertCanViewClip, assertActiveClipUser, loadClipsConfig, assertClipsEnabled, consumeClipRate } from './access';

export const setClipInteraction = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid);
  const id = clipId(request.data?.clipId), type = request.data?.type, active = request.data?.active;
  if (!['like', 'save', 'hide'].includes(type) || typeof active !== 'boolean') throw new HttpsError('invalid-argument', 'interaction-invalid');
  await consumeClipRate(db, uid, 'interaction', 90);
  const ref = db.doc(`clips/${id}`);
  return db.runTransaction(async tx => {
    const clip = await tx.get(ref);
    if (!clip.exists) throw new HttpsError('not-found', 'clip-unavailable');
    await assertCanViewClip(db, clip.data() as ClipDoc, uid, false, tx);
    if (clip.get('status') !== 'published') throw new HttpsError('failed-precondition', 'clip-not-published');
    const rowRef = type === 'like' ? ref.collection('likes').doc(uid)
      : db.doc(`clipProfiles/${uid}/${type === 'save' ? 'saved' : 'hidden'}/${id}`);
    const previous = await tx.get(rowRef);
    let likeCount = Math.max(0, clip.get('likeCount') ?? 0);
    if (active === previous.exists) return { ok: true, likeCount };
    const now = FieldValue.serverTimestamp();
    if (active) tx.create(rowRef, { clipId: id, uid, createdAt: now }); else tx.delete(rowRef);
    if (type === 'like') {
      writeSocialActivity(db, tx, clip.get('ownerUid'), { kind: 'like', actorUid: uid, clipId: id }, active);
      likeCount = Math.max(0, likeCount + (active ? 1 : -1));
      tx.update(ref, { likeCount, updatedAt: now });
    }
    if (type === 'save') {
      const mirror = ref.collection('saves').doc(uid);
      if (active) tx.set(mirror, { uid, createdAt: now }); else tx.delete(mirror);
    }
    return { ok: true, likeCount };
  });
});
export const recordClipView = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, uid);
  const id = clipId(request.data?.clipId), ref = db.doc(`clips/${id}`), viewRef = ref.collection('views').doc(uid);
  await db.runTransaction(async tx => {
    const [clip, view] = await tx.getAll(ref, viewRef);
    if (!clip.exists) throw new HttpsError('not-found', 'clip-unavailable');
    await assertCanViewClip(db, clip.data() as ClipDoc, uid, false, tx);
    if (clip.get('status') !== 'published' || view.exists || clip.get('ownerUid') === uid) return;
    tx.create(viewRef, { uid, createdAt: FieldValue.serverTimestamp() });
    tx.update(ref, { viewCount: FieldValue.increment(1) });
  });
  return { ok: true };
});
export const reportClip = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore();
  assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, uid);
  const id = clipId(request.data?.clipId), commentId = request.data?.commentId == null ? null : clipId(request.data.commentId, 'commentId');
  const reason = request.data?.reason;
  if (!['spam', 'abuse', 'sexual', 'violence', 'copyright', 'other'].includes(reason)) throw new HttpsError('invalid-argument', 'report-reason-invalid');
  const details = cleanClipText(request.data?.details ?? '', 1000, 'details');
  await consumeClipRate(db, uid, 'report', 10);
  const reportId = createHash('sha256').update(`${uid}:${id}:${commentId ?? ''}`).digest('hex');
  const reportRef = db.doc(`clipReports/${reportId}`);
  await db.runTransaction(async tx => {
    const [clip, prior] = await tx.getAll(db.doc(`clips/${id}`), reportRef);
    if (!clip.exists) throw new HttpsError('not-found', 'clip-unavailable');
    await assertCanViewClip(db, clip.data() as ClipDoc, uid, false, tx);
    if (commentId && !(await tx.get(db.doc(`clips/${id}/comments/${commentId}`))).exists)
      throw new HttpsError('not-found', 'comment-not-found');
    if (prior.exists) return;
    tx.create(reportRef, { clipId: id, ownerUid: clip.get('ownerUid'), reporterUid: uid, commentId,
      reason, details, status: 'open', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true, reportId };
});
