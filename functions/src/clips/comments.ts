import { writeSocialActivity } from '../social/activityModel';
import { createHash } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, FieldPath, Timestamp } from 'firebase-admin/firestore';
import { clipId, cleanClipText, pageLimit, decodeClipCursor, encodeClipCursor, millis, type ClipDoc } from './model';
import { requireClipUid, assertClipMutation, assertCanViewClip, assertActiveClipUser, loadClipsConfig, assertClipsEnabled, consumeClipRate, clipsBlocked } from './access';
import { publicClipAuthor } from './profiles';

export const listClipComments = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, uid);
  const id = clipId(request.data?.clipId), ref = db.doc(`clips/${id}`), clip = await ref.get();
  if (!clip.exists) throw new HttpsError('not-found', 'clip-unavailable');
  await assertCanViewClip(db, clip.data() as ClipDoc, uid);
  const parentId = request.data?.parentId == null ? null : clipId(request.data.parentId, 'parentId');
  const limit = pageLimit(request.data?.limit), cursor = decodeClipCursor(request.data?.cursor);
  let query = ref.collection('comments').where('parentId', '==', parentId).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit);
  if (cursor) query = query.startAfter(new Timestamp(cursor[0], cursor[1]), cursor[2]);
  const rows = await query.get(), items = [];
  for (const row of rows.docs) {
    const c = row.data();
    if ((!c.authorUid && c.deleted !== true) || (c.authorUid && await clipsBlocked(db, uid, c.authorUid))) continue;
    const [author, liked] = await Promise.all([c.authorUid ? publicClipAuthor(db, c.authorUid) : Promise.resolve({ uid: '', displayName: '', username: '', photoURL: null, privateAccount: false }), row.ref.collection('likes').doc(uid).get()]);
    items.push({ id: row.id, authorUid: c.authorUid ?? '', author,
      text: c.deleted ? '' : c.text ?? '', parentId: c.parentId ?? null,
      createdAtMs: millis(c.createdAt), likeCount: Math.max(0, c.likeCount ?? 0), likedByMe: liked.exists,
      replyCount: Math.max(0, c.replyCount ?? 0), deleted: c.deleted === true,
      canDelete: c.deleted !== true && (c.authorUid === uid || clip.get('ownerUid') === uid),
    });
  }
  const last = rows.docs[rows.size - 1];
  return { items, nextCursor: rows.size === limit && last ? encodeClipCursor(last.get('createdAt'), last.id) : null };
});
export const addClipComment = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid);
  const id = clipId(request.data?.clipId), text = cleanClipText(request.data?.text, 1000, 'comment');
  if (!text) throw new HttpsError('invalid-argument', 'comment-empty');
  const clientId = clipId(request.data?.clientId, 'clientId');
  const parentId = request.data?.parentId == null ? null : clipId(request.data.parentId, 'parentId');
  const commentId = createHash('sha256').update(`${uid}:${clientId}`).digest('hex');
  const ref = db.doc(`clips/${id}`), commentRef = ref.collection('comments').doc(commentId);
  await consumeClipRate(db, uid, 'comment', 15);
  await db.runTransaction(async tx => {
    const [clip, existing] = await tx.getAll(ref, commentRef);
    if (!clip.exists) throw new HttpsError('not-found', 'clip-unavailable');
    await assertCanViewClip(db, clip.data() as ClipDoc, uid, false, tx);
    if (existing.exists) return;
    if (clip.get('status') !== 'published' || clip.get('allowComments') !== true) throw new HttpsError('failed-precondition', 'clip-comments-disabled');
    const parentRef = parentId ? ref.collection('comments').doc(parentId) : null;
    const parent = parentRef ? await tx.get(parentRef) : null;
    if (parent && (!parent.exists || parent.get('parentId') != null || parent.get('deleted') === true))
      throw new HttpsError('failed-precondition', 'comment-parent-unavailable');
    if (parent && await clipsBlocked(db, uid, parent.get('authorUid'), tx)) throw new HttpsError('not-found', 'comment-parent-unavailable');
    writeSocialActivity(db, tx, clip.get('ownerUid'), { kind: 'comment', actorUid: uid, clipId: id, commentId });
    if (parent && parent.get('authorUid') !== clip.get('ownerUid')) writeSocialActivity(db, tx, parent.get('authorUid'), { kind: 'reply', actorUid: uid, clipId: id, commentId });
    tx.create(commentRef, { authorUid: uid, text, parentId, likeCount: 0, replyCount: 0, deleted: false, clientId,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, { commentCount: FieldValue.increment(1) });
    if (parentRef) tx.update(parentRef, { replyCount: FieldValue.increment(1) });
  });
  return { commentId };
});
export const deleteClipComment = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertActiveClipUser(db, uid);
  const id = clipId(request.data?.clipId), commentId = clipId(request.data?.commentId, 'commentId');
  const ref = db.doc(`clips/${id}`), commentRef = ref.collection('comments').doc(commentId);
  await db.runTransaction(async tx => {
    await assertActiveClipUser(db, uid, tx);
    const [clip, comment] = await tx.getAll(ref, commentRef);
    if (!clip.exists || !comment.exists || (clip.get('ownerUid') !== uid && comment.get('authorUid') !== uid))
      throw new HttpsError('permission-denied', 'comment-delete-denied');
    if (comment.get('deleted') === true) return;
    const parentRef = comment.get('parentId') ? ref.collection('comments').doc(comment.get('parentId')) : null;
    const parent = parentRef ? await tx.get(parentRef) : null;
    tx.update(commentRef, { deleted: true, text: '', updatedAt: FieldValue.serverTimestamp(), deletedBy: uid });
    tx.update(ref, { commentCount: Math.max(0, (clip.get('commentCount') ?? 0) - 1) });
    if (parentRef && parent?.exists) tx.update(parentRef, { replyCount: Math.max(0, (parent.get('replyCount') ?? 0) - 1) });
  });
  return { ok: true };
});
export const setClipCommentLike = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid);
  const id = clipId(request.data?.clipId), commentId = clipId(request.data?.commentId, 'commentId'), active = request.data?.active;
  if (typeof active !== 'boolean') throw new HttpsError('invalid-argument', 'active-invalid');
  await consumeClipRate(db, uid, 'commentLike', 90);
  const ref = db.doc(`clips/${id}`), commentRef = ref.collection('comments').doc(commentId), likeRef = commentRef.collection('likes').doc(uid);
  return db.runTransaction(async tx => {
    const [clip, comment, like] = await tx.getAll(ref, commentRef, likeRef);
    if (!clip.exists || !comment.exists || comment.get('deleted') === true) throw new HttpsError('not-found', 'comment-unavailable');
    await assertCanViewClip(db, clip.data() as ClipDoc, uid, false, tx);
    if (clip.get('status') !== 'published') throw new HttpsError('failed-precondition', 'clip-not-published');
    if (await clipsBlocked(db, uid, comment.get('authorUid'), tx)) throw new HttpsError('not-found', 'comment-unavailable');
    let likeCount = Math.max(0, comment.get('likeCount') ?? 0);
    if (like.exists !== active) {
      likeCount = Math.max(0, likeCount + (active ? 1 : -1));
      if (active) tx.create(likeRef, { uid, createdAt: FieldValue.serverTimestamp() }); else tx.delete(likeRef);
      writeSocialActivity(db, tx, comment.get('authorUid'), { kind: 'commentLike', actorUid: uid, clipId: id, commentId }, active);
      tx.update(commentRef, { likeCount });
    }
    return { ok: true, likeCount };
  });
});
