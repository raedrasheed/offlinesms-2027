import { assertPostsEnabled } from './postsFeature';
import { createHash, randomUUID } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { FieldPath, FieldValue, Timestamp, getFirestore, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { requireClipUid, assertActiveClipUser, assertClipMutation, assertCanViewClip, assertClipsEnabled, loadClipsConfig, consumeClipRate, clipsBlocked } from '../clips/access';
import { clipId, cleanClipText, decodeClipCursor, encodeClipCursor, millis, pageLimit, type ClipDoc, clipsConfig } from '../clips/model';
import { publicClipAuthor } from '../clips/profiles';
import { activeSocialAccount, assertSocialUser } from './access';
import { writeSocialActivity } from './activityModel';
import { decodePostImage, sanitizePostImage } from './postImages';

async function assertPostAccess(db: Firestore, post: ClipDoc, uid: string, _admin = false, tx?: Transaction) {
  await assertSocialUser(db, uid, tx);
  const [owner, profile] = await (tx ?? db).getAll(db.doc(`users/${post.ownerUid}`), db.doc(`clipProfiles/${post.ownerUid}`));
  if (!activeSocialAccount(owner.data(), profile.data())) throw new HttpsError('not-found', 'post-unavailable');
  await assertCanViewClip(db, post, uid, false, tx);
}

export function validatePost(input: Record<string, unknown>) {
  const body = cleanClipText(input.body ?? '', 2200, 'post-body');
  if (!['public', 'followers', 'private'].includes(input.audience as string)) throw new HttpsError('invalid-argument', 'post-audience-invalid');
  const image = decodePostImage(input.imageBase64);
  if (!body && !image) throw new HttpsError('invalid-argument', 'post-empty');
  return { body, audience: input.audience as 'public' | 'followers' | 'private', image };
}
export async function serializePost(db: Firestore, row: DocumentSnapshot, uid: string) {
  const post = row.data()!;
  const [author, liked] = await Promise.all([publicClipAuthor(db, post.ownerUid), row.ref.collection('postLikes').doc(uid).get()]);
  let imageUrl: string | null = null, imageExpiresAtMs = 0;
  if (typeof post.imagePath === 'string' && post.imagePath.startsWith(`postMedia/${post.ownerUid}/${row.id}/`)) {
    imageExpiresAtMs = Date.now() + 120_000;
    [imageUrl] = await getStorage().bucket().file(post.imagePath).getSignedUrl({ version: 'v4', action: 'read', expires: imageExpiresAtMs });
  }
  return { id: row.id, ownerUid: post.ownerUid, body: post.body ?? '', audience: post.audience, status: post.status, author,
    imageUrl, imageExpiresAtMs, createdAtMs: millis(post.createdAt), publishedAtMs: millis(post.publishedAt),
    likeCount: Math.max(0, post.likeCount ?? 0), commentCount: Math.max(0, post.commentCount ?? 0), likedByMe: liked.exists,
    canDelete: post.ownerUid === uid, moderationReason: post.ownerUid === uid ? post.moderationReason ?? null : null };
}
async function postRead(uid: string, id: string) {
  const db = getFirestore(); assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, uid);
  const row = await db.doc(`posts/${id}`).get();
  if (!row.exists) throw new HttpsError('not-found', 'post-unavailable');
  await assertPostAccess(db, row.data() as ClipDoc, uid); return row;
}
export const createPost = onCall({ region: 'us-central1', memory: '1GiB', timeoutSeconds: 120, concurrency: 1 }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid); await assertSocialUser(db, uid);
  const clientId = clipId(request.data?.clientId, 'clientId'), data = validatePost(request.data ?? {});
  const id = createHash('sha256').update(`${uid}:${clientId}`).digest('hex'), ref = db.doc(`posts/${id}`), previous = await ref.get();
  if (previous.exists) {
    if (previous.get('status') === 'removed') throw new HttpsError('failed-precondition', 'post-removed');
    return { post: await serializePost(db, previous, uid) };
  }
  await consumeClipRate(db, uid, 'postCreate', 5);
  let imagePath: string | null = null;
  try {
    if (data.image) {
      const sanitized = await sanitizePostImage(data.image);
      // Concurrent retries must not overwrite or clean up the same object. The
      // post ID is idempotent, but each tentative upload owns its unique path.
      const imageKey = createHash('sha256').update(sanitized.digest).update(randomUUID()).digest('hex');
      imagePath = `postMedia/${uid}/${id}/${imageKey}.jpg`;
      // The object may be committed even when save rejects after losing its
      // acknowledgement, so upload belongs inside the same cleanup boundary.
      await getStorage().bucket().file(imagePath).save(sanitized.bytes, { resumable: false, metadata: { contentType: 'image/jpeg', cacheControl: 'private, max-age=0' } });
    }
    await db.runTransaction(async tx => {
      await assertActiveClipUser(db, uid, tx); await assertSocialUser(db, uid, tx);
      const [existing, settings, profile] = await tx.getAll(ref, db.doc('systemSettings/clips'), db.doc(`clipProfiles/${uid}`));
      const liveConfig = clipsConfig(settings.data()); assertClipsEnabled(liveConfig);
      if (profile.get('termsVersion') !== liveConfig.termsVersion) throw new HttpsError('failed-precondition', 'clips-terms-required');
      if (existing.exists) return;
      const now = FieldValue.serverTimestamp();
      tx.create(ref, { ownerUid: uid, body: data.body, audience: data.audience, status: liveConfig.moderationRequired ? 'pending_review' : 'published',
        imagePath, createdAt: now, updatedAt: now, publishedAt: liveConfig.moderationRequired ? null : now, likeCount: 0, commentCount: 0, moderationReason: null });
    });
  } catch (error) {
    // Never delete a concurrent successful retry's referenced image.
    if (imagePath) {
      const failed = await ref.get();
      if (failed.get('status') === 'removed' || failed.get('imagePath') !== imagePath) await getStorage().bucket().file(imagePath).delete({ ignoreNotFound: true });
    }
    throw error;
  }
  const stored = await ref.get();
  if (imagePath && (stored.get('status') === 'removed' || stored.get('imagePath') !== imagePath)) await getStorage().bucket().file(imagePath).delete({ ignoreNotFound: true });
  if (stored.get('status') === 'removed') throw new HttpsError('failed-precondition', 'post-removed');
  return { post: await serializePost(db, stored, uid) };
});
export const getPost = onCall({ region: 'us-central1' }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), row = await postRead(uid, clipId(request.data?.postId, 'postId'));
  return { post: await serializePost(getFirestore(), row, uid) };
});
export const listPosts = onCall({ region: 'us-central1' }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), db = getFirestore(); assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, uid);
  const mode = request.data?.mode ?? 'feed';
  if (!['feed', 'mine'].includes(mode)) throw new HttpsError('invalid-argument', 'post-feed-invalid');
  const limit = pageLimit(request.data?.limit), cursor = decodeClipCursor(request.data?.cursor);
  let query = db.collection('posts').where(mode === 'mine' ? 'ownerUid' : 'status', '==', mode === 'mine' ? uid : 'published')
    .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit);
  if (cursor) query = query.startAfter(new Timestamp(cursor[0], cursor[1]), cursor[2]);
  const rows = await query.get(), items = [];
  for (const row of rows.docs) {
    try { await assertPostAccess(db, row.data() as ClipDoc, uid); }
    catch (error) { if (error instanceof HttpsError && error.code === 'not-found') continue; throw error; }
    items.push(await serializePost(db, row, uid));
  }
  const last = rows.docs[rows.size - 1];
  return { items, nextCursor: rows.size === limit && last ? encodeClipCursor(last.get('createdAt'), last.id) : null };
});
export const deletePost = onCall({ region: 'us-central1' }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), db = getFirestore(), ref = db.doc(`posts/${clipId(request.data?.postId, 'postId')}`);
  await db.runTransaction(async tx => {
    await assertActiveClipUser(db, uid, tx); await assertSocialUser(db, uid, tx); const row = await tx.get(ref);
    if (!row.exists || row.get('ownerUid') !== uid) throw new HttpsError('not-found', 'post-unavailable');
    if (row.get('status') !== 'removed') tx.update(ref, { status: 'removed', deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
export const setPostLike = onCall({ region: 'us-central1' }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid); await assertSocialUser(db, uid);
  const id = clipId(request.data?.postId, 'postId'), active = request.data?.active;
  if (typeof active !== 'boolean') throw new HttpsError('invalid-argument', 'active-invalid');
  await consumeClipRate(db, uid, 'postLike', 90);
  const ref = db.doc(`posts/${id}`), likeRef = ref.collection('postLikes').doc(uid);
  return db.runTransaction(async tx => {
    const [row, previous] = await tx.getAll(ref, likeRef);
    if (!row.exists) throw new HttpsError('not-found', 'post-unavailable');
    await assertPostAccess(db, row.data() as ClipDoc, uid, false, tx);
    if (row.get('status') !== 'published') throw new HttpsError('failed-precondition', 'post-not-published');
    let likeCount = Math.max(0, row.get('likeCount') ?? 0);
    if (active !== previous.exists) {
      likeCount = Math.max(0, likeCount + (active ? 1 : -1));
      if (active) tx.create(likeRef, { uid, createdAt: FieldValue.serverTimestamp() }); else tx.delete(likeRef);
      tx.update(ref, { likeCount });
      writeSocialActivity(db, tx, row.get('ownerUid'), { kind: 'postLike', actorUid: uid, postId: id }, active);
    }
    return { likeCount };
  });
});
export const listPostComments = onCall({ region: 'us-central1' }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), db = getFirestore(), row = await postRead(uid, clipId(request.data?.postId, 'postId'));
  const limit = pageLimit(request.data?.limit), cursor = decodeClipCursor(request.data?.cursor);
  let query = row.ref.collection('postComments').orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit);
  if (cursor) query = query.startAfter(new Timestamp(cursor[0], cursor[1]), cursor[2]);
  const rows = await query.get(), items = [];
  for (const comment of rows.docs) {
    const data = comment.data();
    if (!data.authorUid || data.deleted || await clipsBlocked(db, uid, data.authorUid)) continue;
    const [user, profile] = await db.getAll(db.doc(`users/${data.authorUid}`), db.doc(`clipProfiles/${data.authorUid}`));
    if (!activeSocialAccount(user.data(), profile.data()) || profile.get('suspended') === true) continue;
    items.push({ id: comment.id, authorUid: data.authorUid, author: await publicClipAuthor(db, data.authorUid), text: data.text,
      createdAtMs: millis(data.createdAt), canDelete: uid === data.authorUid || row.get('ownerUid') === uid });
  }
  const last = rows.docs[rows.size - 1];
  return { items, nextCursor: rows.size === limit && last ? encodeClipCursor(last.get('createdAt'), last.id) : null };
});
export const addPostComment = onCall({ region: 'us-central1' }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid); await assertSocialUser(db, uid);
  const id = clipId(request.data?.postId, 'postId'), clientId = clipId(request.data?.clientId, 'clientId'), text = cleanClipText(request.data?.text, 1000, 'comment');
  if (!text) throw new HttpsError('invalid-argument', 'comment-empty');
  const commentId = createHash('sha256').update(`${uid}:${clientId}`).digest('hex'), ref = db.doc(`posts/${id}`), commentRef = ref.collection('postComments').doc(commentId);
  await consumeClipRate(db, uid, 'postComment', 15);
  await db.runTransaction(async tx => {
    const [row, prior] = await tx.getAll(ref, commentRef);
    if (!row.exists) throw new HttpsError('not-found', 'post-unavailable');
    await assertPostAccess(db, row.data() as ClipDoc, uid, false, tx);
    if (row.get('status') !== 'published') throw new HttpsError('failed-precondition', 'post-not-published');
    if (prior.exists) return;
    tx.create(commentRef, { authorUid: uid, text, deleted: false, createdAt: FieldValue.serverTimestamp() });
    tx.update(ref, { commentCount: FieldValue.increment(1) });
    writeSocialActivity(db, tx, row.get('ownerUid'), { kind: 'postComment', actorUid: uid, postId: id, commentId });
  });
  return { commentId };
});
export const deletePostComment = onCall({ region: 'us-central1' }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), db = getFirestore(), id = clipId(request.data?.postId, 'postId'), commentId = clipId(request.data?.commentId, 'commentId');
  const ref = db.doc(`posts/${id}`), commentRef = ref.collection('postComments').doc(commentId);
  await db.runTransaction(async tx => {
    await assertActiveClipUser(db, uid, tx); await assertSocialUser(db, uid, tx); const [row, comment] = await tx.getAll(ref, commentRef);
    if (!row.exists || !comment.exists || (row.get('ownerUid') !== uid && comment.get('authorUid') !== uid)) throw new HttpsError('permission-denied', 'comment-delete-denied');
    if (comment.get('deleted') === true) return;
    tx.update(commentRef, { deleted: true, text: '', updatedAt: FieldValue.serverTimestamp() });
    tx.update(ref, { commentCount: Math.max(0, (row.get('commentCount') ?? 0) - 1) });
    writeSocialActivity(db, tx, row.get('ownerUid'), { kind: 'postComment', actorUid: comment.get('authorUid'), postId: id, commentId }, false);
  });
  return { ok: true };
});
export const reportPost = onCall({ region: 'us-central1' }, async request => {
  assertPostsEnabled();
  const uid = requireClipUid(request), db = getFirestore(), id = clipId(request.data?.postId, 'postId');
  const reason = request.data?.reason, details = cleanClipText(request.data?.details ?? '', 1000, 'details');
  if (!['spam', 'abuse', 'sexual', 'violence', 'copyright', 'other'].includes(reason)) throw new HttpsError('invalid-argument', 'report-reason-invalid');
  await postRead(uid, id); await consumeClipRate(db, uid, 'postReport', 10);
  const reportId = createHash('sha256').update(`${uid}:${id}`).digest('hex'), reportRef = db.doc(`postReports/${reportId}`);
  await db.runTransaction(async tx => {
    const [row, prior] = await tx.getAll(db.doc(`posts/${id}`), reportRef);
    if (!row.exists) throw new HttpsError('not-found', 'post-unavailable');
    await assertPostAccess(db, row.data() as ClipDoc, uid, false, tx);
    if (!prior.exists) tx.create(reportRef, { postId: id, ownerUid: row.get('ownerUid'), reporterUid: uid, reason, details, status: 'open', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
  return { ok: true, reportId };
});
export const onPostRemoved = onDocumentWritten({ document: 'posts/{postId}', region: 'us-central1', retry: true }, async event => {
  const before = event.data?.before.data(), after = event.data?.after.data();
  if (after && after.status !== 'removed') return;
  const row = after ?? before;
  if (typeof row?.imagePath === 'string' && row.imagePath.startsWith(`postMedia/${row.ownerUid}/${event.params.postId}/`))
    await getStorage().bucket().file(row.imagePath).delete({ ignoreNotFound: true });
});
