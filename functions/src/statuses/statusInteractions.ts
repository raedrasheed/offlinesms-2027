import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldPath, FieldValue } from 'firebase-admin/firestore';
import { publicNameFrom } from '../lib/displayName';
import { getOrCreateDirectConversation } from '../chats/getOrCreateDirectConversation';
import { sendTextMessage } from '../chats/sendTextMessage';
import { assertStatusAccess, assertStatusNotSuspended, statusIdInput } from './statusAccess';
import { socialActivityId, writeSocialActivity } from '../social/activityModel';
import { isStatusAudienceMember } from './statusLogic';

/** Resolve one activity destination without relying on a cached/bounded feed. */
export const getStatus = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const statusId = statusIdInput(request.data?.statusId), db = getFirestore();
  const snapshot = await db.doc(`statuses/${statusId}`).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'status-not-found');
  const s = snapshot.data()!;
  await assertStatusAccess(db, uid, s);
  const [author, view, like] = await db.getAll(db.doc(`users/${s.authorId}`), snapshot.ref.collection('views').doc(uid), snapshot.ref.collection('likes').doc(uid));
  return { item: {
    statusId, authorId: s.authorId, authorName: publicNameFrom(author.data(), s.authorId) ?? '',
    authorPhotoURL: author.get('photoURL') ?? s.authorPhotoURL ?? null,
    type: s.type === 'image' || s.type === 'video' ? s.type : 'text', body: s.body ?? '',
    mediaUrl: s.mediaUrl ?? null, durationMs: s.durationMs ?? null, backgroundColor: s.backgroundColor ?? null,
    createdAtMs: s.createdAt?.toMillis?.() ?? 0, expiresAtMs: s.expiresAt?.toMillis?.() ?? 0,
    viewedByMe: view.exists, likedByMe: like.exists, likeCount: s.likeCount ?? 0,
    mentions: Array.isArray(s.mentions) ? s.mentions : [],
  }, isMine: s.authorId === uid };
});

export const setStatusLike = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const statusId = statusIdInput(request.data?.statusId);
  if (typeof request.data?.liked !== 'boolean') throw new HttpsError('invalid-argument', 'liked-required');
  const liked = request.data.liked;
  const db = getFirestore(), ref = db.doc(`statuses/${statusId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'status-not-found');
  await assertStatusAccess(db, uid, snapshot.data()!);
  if (snapshot.get('authorId') === uid) throw new HttpsError('invalid-argument', 'cannot-like-own-status');
  return db.runTransaction(async tx => {
    const [fresh, previous] = await Promise.all([tx.get(ref), tx.get(ref.collection('likes').doc(uid))]);
    if (!fresh.exists) throw new HttpsError('not-found', 'status-not-found');
    assertStatusNotSuspended(fresh.data()!);
    if ((fresh.get('expiresAt')?.toMillis?.() ?? 0) <= Date.now()) throw new HttpsError('failed-precondition', 'status-expired');
    if (fresh.get('authorId') !== snapshot.get('authorId') || !isStatusAudienceMember(fresh.data()!, uid)) throw new HttpsError('permission-denied', 'not-in-audience');
    const count = Math.max(0, Number(fresh.get('likeCount') ?? 0));
    if (previous.exists === liked) return { liked, likeCount: count };
    const next = Math.max(0, count + (liked ? 1 : -1));
    if (liked) tx.set(previous.ref, { uid, createdAt: FieldValue.serverTimestamp() });
    else tx.delete(previous.ref);
    tx.update(ref, { likeCount: next });
    writeSocialActivity(db, tx, fresh.get('authorId'), { kind: 'statusLike', actorUid: uid, statusId }, liked);
    return { liked, likeCount: next };
  });
});

export const listStatusViewers = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const statusId = statusIdInput(request.data?.statusId);
  const after = request.data?.after;
  if (after !== undefined && (typeof after !== 'string' || !after || after.length > 128 || after.includes('/'))) {
    throw new HttpsError('invalid-argument', 'cursor-invalid');
  }
  const db = getFirestore(), ref = db.doc(`statuses/${statusId}`), snapshot = await ref.get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'status-not-found');
  await assertStatusAccess(db, uid, snapshot.data()!, true);
  let query = ref.collection('views').orderBy(FieldPath.documentId()).limit(51);
  if (after) query = query.startAfter(after);
  const page = await query.get(), rows = page.docs.slice(0, 50);
  const profiles = rows.length ? await db.getAll(...rows.map(v => db.doc(`users/${v.id}`))) : [];
  const likes = rows.length ? await db.getAll(...rows.map(v => ref.collection('likes').doc(v.id))) : [];
  return {
    viewers: rows.map((v, i) => ({
      uid: v.id, name: publicNameFrom(profiles[i].data(), v.id) ?? '',
      photoURL: typeof profiles[i].get('photoURL') === 'string' ? profiles[i].get('photoURL') : null,
      viewedAtMs: v.get('viewedAt')?.toMillis?.() ?? 0, liked: likes[i].exists,
    })),
    next: page.size > 50 ? rows[rows.length - 1].id : null,
  };
});

export const replyToStatus = onCall(async request => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  const statusId = statusIdInput(request.data?.statusId);
  const text = typeof request.data?.text === 'string' ? request.data.text.trim() : '';
  const localId = request.data?.localId;
  if (!text || text.length > 3000) throw new HttpsError('invalid-argument', 'reply-invalid');
  if (typeof localId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(localId)) throw new HttpsError('invalid-argument', 'reply-id-required');
  const db = getFirestore(), snapshot = await db.doc(`statuses/${statusId}`).get();
  if (!snapshot.exists) throw new HttpsError('not-found', 'status-not-found');
  await assertStatusAccess(db, uid, snapshot.data()!);
  const owner = snapshot.get('authorId');
  if (owner === uid) throw new HttpsError('invalid-argument', 'cannot-reply-own-status');
  // Reuse the normal DM membership/block/send pipeline and its notification trigger.
  // No downloadable story URL is copied into a message or exposed to another audience.
  const direct = await getOrCreateDirectConversation.run({ ...request, data: { otherUserId: owner } });
  const quote = typeof snapshot.get('body') === 'string' ? snapshot.get('body').slice(0, 140) : '';
  const sent = await sendTextMessage.run({ ...request, data: {
    conversationId: direct.conversationId, text: `↩ ${quote || '◉'}\n${text}`,
    localId: `status_${statusId}_${uid}_${localId}`, idempotencyKey: `status_${statusId}_${uid}_${localId}`,
  } });
  const activity = { kind: 'statusReply' as const, actorUid: uid, statusId, messageId: sent.messageId, conversationId: direct.conversationId };
  await db.runTransaction(async tx => {
    const previous = await tx.get(db.doc(`clipProfiles/${owner}/activity/${socialActivityId(activity)}`));
    if (!previous.exists) writeSocialActivity(db, tx, owner, activity);
  });
  return { conversationId: direct.conversationId, messageId: sent.messageId };
});
