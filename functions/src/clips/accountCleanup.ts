import { randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp, getFirestore, type Firestore, type DocumentSnapshot } from 'firebase-admin/firestore';
import { onDocumentDeleted, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { region } from 'firebase-functions/v1';

const JOBS = 'clipAccountErasureJobs';
const PAGE_SIZE = 25;
const LEASE_MS = 150_000;
const PHASES = ['clips', 'followers', 'following', 'likes', 'saves', 'views', 'comments', 'shares', 'reports',
  'saved', 'hidden', 'activity', 'rateLimits', 'uploadQuota', 'posts', 'postLikes', 'postComments', 'postReports', 'socialActivityActor', 'done'] as const;
type Phase = typeof PHASES[number];
function erasureUid(uid: string): void {
  // Account deletion also serves legacy/custom Firebase identities that never
  // used Clips; do not impose the more restrictive public clip-ID alphabet.
  if (typeof uid !== 'string' || !uid || uid.length > 128 || /[\/\u0000-\u001f]/.test(uid) || uid === '.' || uid === '..')
    throw new Error('account-erasure-uid-invalid');
}

/** This durable fence must succeed BEFORE deleting Auth or the user profile.
 * Keep the tombstone after erasure: old upload reservations and cached tokens
 * must never restore a publisher or create a fresh social profile. */
export async function queueClipAccountErasure(db: Firestore, uid: string): Promise<void> {
  erasureUid(uid);
  const profile = db.doc(`clipProfiles/${uid}`), job = db.doc(`${JOBS}/${uid}`);
  await db.runTransaction(async tx => {
    const prior = await tx.get(job);
    tx.set(profile, { suspended: true, deleting: true, deletedAccount: true, updatedAt: FieldValue.serverTimestamp() });
    if (!prior.exists) tx.create(job, { status: 'pending', phase: 'clips', cursor: null,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), leaseToken: null, leaseUntil: null });
  });
}
function isClipChild(row: DocumentSnapshot, collection: string): boolean {
  const parts = row.ref.path.split('/');
  return parts[0] === 'clips' && ((parts.length === 4 && parts[2] === collection)
    || (collection === 'likes' && parts.length === 6 && parts[2] === 'comments' && parts[4] === 'likes'));
}
async function removeFollow(db: Firestore, uid: string, row: DocumentSnapshot, phase: 'followers' | 'following') {
  const peer = row.id;
  const mirror = db.doc(`clipProfiles/${peer}/${phase === 'followers' ? 'following' : 'followers'}/${uid}`);
  const profile = db.doc(`clipProfiles/${peer}`);
  const count = phase === 'followers' ? 'followingCount' : 'followerCount';
  await db.runTransaction(async tx => {
    const [live, other, owner] = await tx.getAll(row.ref, mirror, profile);
    if (!live.exists && !other.exists) return;
    if ((live.get('status') === 'accepted' || other.get('status') === 'accepted') && owner.exists && owner.get('deleting') !== true)
      tx.update(profile, { [count]: Math.max(0, (Number(owner.get(count)) || 0) - 1), updatedAt: FieldValue.serverTimestamp() });
    tx.delete(row.ref); tx.delete(mirror);
  });
}
async function removeInteraction(db: Firestore, uid: string, row: DocumentSnapshot, phase: 'likes' | 'saves' | 'views') {
  if (!isClipChild(row, phase)) return;
  const parent = row.ref.parent.parent!;
  await db.runTransaction(async tx => {
    const [live, target] = await tx.getAll(row.ref, parent);
    if (!live.exists || live.get('uid') !== uid) return;
    if (phase === 'likes' && target.exists)
      tx.update(parent, { likeCount: Math.max(0, (Number(target.get('likeCount')) || 0) - 1) });
    // Views and shares are historical totals. Erasing the identity does not
    // rewrite aggregate viewing history; likes remain a current-state count.
    tx.delete(row.ref);
  });
}
async function eraseComment(db: Firestore, uid: string, row: DocumentSnapshot) {
  if (!isClipChild(row, 'comments')) return;
  const clipRef = row.ref.parent.parent!;
  await db.runTransaction(async tx => {
    const [comment, clip] = await tx.getAll(row.ref, clipRef);
    if (!comment.exists || comment.get('authorUid') !== uid) return;
    const parentId = comment.get('parentId');
    const parent = typeof parentId === 'string' ? await tx.get(clipRef.collection('comments').doc(parentId)) : null;
    if (comment.get('deleted') !== true) {
      if (clip.exists) tx.update(clipRef, { commentCount: Math.max(0, (Number(clip.get('commentCount')) || 0) - 1) });
      if (parent?.exists) tx.update(parent.ref, { replyCount: Math.max(0, (Number(parent.get('replyCount')) || 0) - 1) });
    }
    // Preserve the empty thread node so other people's replies retain structure.
    tx.update(row.ref, { authorUid: null, text: '', deleted: true, clientId: FieldValue.delete(),
      deletedBy: FieldValue.delete(), deletedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
  });
}
async function erasePage(db: Firestore, uid: string, phase: Phase, cursor: string | null) {
  let query: FirebaseFirestore.Query;
  if (phase === 'clips') query = db.collection('clips').where('ownerUid', '==', uid);
  else if (phase === 'posts') query = db.collection('posts').where('ownerUid', '==', uid);
  else if (phase === 'socialActivityActor') query = db.collectionGroup('activity').where('actorUid', '==', uid);
  else if (phase === 'postReports') query = db.collection('postReports').where('reporterUid', '==', uid);
  else if (phase === 'postLikes' || phase === 'postComments') query = db.collectionGroup(phase).where(phase === 'postLikes' ? 'uid' : 'authorUid', '==', uid);
  else if (phase === 'reports') query = db.collection('clipReports').where('reporterUid', '==', uid);
  else if (['likes', 'saves', 'views', 'comments', 'shares'].includes(phase)) {
    const field = phase === 'comments' ? 'authorUid' : phase === 'shares' ? 'senderUid' : 'uid';
    query = db.collectionGroup(phase).where(field, '==', uid);
  } else query = db.collection(`clipProfiles/${uid}/${phase}`);
  query = query.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if (cursor) query = query.startAfter(db.doc(cursor));
  const rows = await query.get();
  for (const row of rows.docs) {
    if (phase === 'clips') {
      await row.ref.update({ status: 'removed', removedReason: 'account-erasure', ownerName: null, ownerPhotoURL: null,
        ownerUsername: null, caption: '', hashtags: [], groupId: null, audience: 'private',
        moderationReason: null, edits: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(), deletedAt: FieldValue.serverTimestamp() });
      // onClipRemoved purges source/output paths using the retained internal uid.
    } else if (phase === 'posts') {
      await row.ref.update({ status: 'removed', body: '', audience: 'private', moderationReason: null, updatedAt: FieldValue.serverTimestamp(), deletedAt: FieldValue.serverTimestamp() });
    } else if (phase === 'postLikes' || phase === 'postComments') {
      const parts = row.ref.path.split('/');
      if (parts.length !== 4 || parts[0] !== 'posts' || parts[2] !== phase) continue;
      await db.runTransaction(async tx => {
        const postRef = row.ref.parent.parent!, [live, post] = await tx.getAll(row.ref, postRef);
        if (!live.exists || live.get(phase === 'postLikes' ? 'uid' : 'authorUid') !== uid) return;
        if (post.exists && (phase === 'postLikes' || live.get('deleted') !== true)) {
          const field = phase === 'postLikes' ? 'likeCount' : 'commentCount';
          tx.update(postRef, { [field]: Math.max(0, (Number(post.get(field)) || 0) - 1) });
        }
        tx.delete(row.ref);
      });
    } else if (phase === 'socialActivityActor') {
      const parts = row.ref.path.split('/');
      if (parts.length === 4 && parts[0] === 'clipProfiles' && parts[2] === 'activity') await row.ref.delete();
    } else if (phase === 'postReports') await row.ref.update({ reporterUid: null, details: '', reporterErased: true, updatedAt: FieldValue.serverTimestamp() });
    else if (phase === 'followers' || phase === 'following') await removeFollow(db, uid, row, phase);
    else if (phase === 'likes' || phase === 'saves' || phase === 'views') await removeInteraction(db, uid, row, phase);
    else if (phase === 'comments') await eraseComment(db, uid, row);
    else if (phase === 'shares') { if (isClipChild(row, 'shares')) await row.ref.delete(); }
    else if (phase === 'reports') await row.ref.update({ reporterUid: null, details: '', reporterErased: true, updatedAt: FieldValue.serverTimestamp() });
    else await row.ref.delete();
  }
  return rows.size === PAGE_SIZE ? rows.docs[rows.size - 1].ref.path : null;
}

/** One checkpointed page per invocation. Every operation is idempotent; a crash
 * before checkpointing replays safely, and the scheduler recovers expired leases. */
export async function processClipAccountErasure(db: Firestore, uid: string): Promise<void> {
  erasureUid(uid);
  const jobRef = db.doc(`${JOBS}/${uid}`), token = randomUUID();
  const state = await db.runTransaction(async tx => {
    const job = await tx.get(jobRef);
    if (!job.exists || job.get('status') === 'done' || (job.get('leaseUntil')?.toMillis?.() ?? 0) > Date.now()
        || (job.get('retryAt')?.toMillis?.() ?? 0) > Date.now()) return null;
    const phase = job.get('phase') as Phase;
    if (!PHASES.includes(phase) || phase === 'done') return null;
    tx.update(jobRef, { leaseToken: token, leaseUntil: Timestamp.fromMillis(Date.now() + LEASE_MS) });
    return { phase, cursor: typeof job.get('cursor') === 'string' ? job.get('cursor') as string : null };
  });
  if (!state) return;
  try {
    const cursor = await erasePage(db, uid, state.phase, state.cursor);
    const nextPhase = cursor ? state.phase : PHASES[PHASES.indexOf(state.phase) + 1];
    await db.runTransaction(async tx => {
      const live = await tx.get(jobRef);
      if (live.get('leaseToken') !== token) return;
      tx.update(jobRef, { phase: nextPhase, cursor, status: nextPhase === 'done' ? 'done' : 'pending',
        leaseToken: null, leaseUntil: null, lastError: FieldValue.delete(), retryAt: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp(),
        ...(nextPhase === 'done' ? { completedAt: FieldValue.serverTimestamp() } : {}) });
    });
  } catch (error) {
    await db.runTransaction(async tx => {
      const live = await tx.get(jobRef);
      if (live.get('leaseToken') === token) tx.update(jobRef, { leaseToken: null, leaseUntil: null,
        lastError: 'erasure-retry-required', retryAt: Timestamp.fromMillis(Date.now() + 60_000), updatedAt: FieldValue.serverTimestamp() });
    });
    throw error;
  }
}

export const onClipAccountErasure = onDocumentWritten({ document: `${JOBS}/{uid}`, region: 'us-central1',
  timeoutSeconds: 120, maxInstances: 3, retry: true }, async event => {
  const after = event.data?.after.data();
  if (!after || after.status === 'done' || after.leaseToken || (after.retryAt?.toMillis?.() ?? 0) > Date.now()) return;
  await processClipAccountErasure(getFirestore(), event.params.uid);
});
export const retryClipAccountErasure = onSchedule({ schedule: 'every 15 minutes', region: 'us-central1', timeoutSeconds: 300 }, async () => {
  const db = getFirestore();
  const jobs = await db.collection(JOBS).where('status', '==', 'pending').orderBy('updatedAt').limit(40).get();
  for (const job of jobs.docs) await processClipAccountErasure(db, job.id).catch(() => {});
});
/** Covers dashboard/admin profile deletion and external Firebase Auth deletion. */
export const onClipUserDeleted = onDocumentDeleted({ document: 'users/{uid}', region: 'us-central1', retry: true }, async event => {
  await queueClipAccountErasure(getFirestore(), event.params.uid);
});
export const onClipAuthUserDeleted = region('us-central1').runWith({ failurePolicy: true }).auth.user().onDelete(async user => {
  await queueClipAccountErasure(getFirestore(), user.uid);
});
