import { POSTS_ENABLED } from './postsFeature';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldPath, FieldValue, Timestamp, getFirestore, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { canViewClip, clipsBlocked, loadClipsConfig, requireClipUid } from '../clips/access';
import { clipId, decodeClipCursor, encodeClipCursor, millis, pageLimit, type ClipDoc } from '../clips/model';
import { publicClipAuthor } from '../clips/profiles';
import { activeSocialAccount, assertSocialUser } from './access';
import { assertStatusAccess } from '../statuses/statusAccess';
import type { SocialActivityKind } from './activityModel';

/** Re-evaluate live content and relationships on every read. An old notification
 * must never bypass a block, account deletion, private account or group removal.
 */
async function visibleActivity(db: Firestore, row: DocumentSnapshot, uid: string, clipsEnabled: boolean) {
  const event = row.data() ?? {}, actorUid = event.actorUid;
  const kind = event.kind as SocialActivityKind;
  if (typeof kind !== 'string') return null;
  if (!POSTS_ENABLED && (event.postId || kind === 'postLike' || kind === 'postComment')) return null;
  if (!kind.startsWith('status') && !clipsEnabled) return null;
  if (typeof actorUid !== 'string' || !actorUid || actorUid === uid) return null;
  const [actor, actorProfile] = await db.getAll(db.doc(`users/${actorUid}`), db.doc(`clipProfiles/${actorUid}`));
  if (!activeSocialAccount(actor.data(), actorProfile.data()) || (!kind.startsWith('status') && actorProfile.get('suspended') === true) || await clipsBlocked(db, uid, actorUid)) return null;
  let followStatus: 'pending' | 'accepted' | null = null;
  if (kind === 'follow' || kind === 'followAccepted') {
    const relation = await db.doc(kind === 'follow'
      ? `clipProfiles/${uid}/followers/${actorUid}` : `clipProfiles/${actorUid}/followers/${uid}`).get();
    const status = relation.get('status');
    if (status !== 'accepted' && !(kind === 'follow' && status === 'pending')) return null;
    followStatus = status;
  } else if (kind === 'postLike' || kind === 'postComment') {
    if (typeof event.postId !== 'string') return null;
    const post = await db.doc(`posts/${event.postId}`).get();
    if (!post.exists || post.get('ownerUid') !== uid || !(await canViewClip(db, post.data() as ClipDoc, uid))) return null;
    if (kind === 'postLike') {
      if (!(await post.ref.collection('postLikes').doc(actorUid).get()).exists) return null;
    } else {
      if (typeof event.commentId !== 'string') return null;
      const comment = await post.ref.collection('postComments').doc(event.commentId).get();
      if (!comment.exists || comment.get('deleted') === true || comment.get('authorUid') !== actorUid) return null;
    }
  } else if (kind.startsWith('status')) {
    if (typeof event.statusId !== 'string') return null;
    const story = await db.doc(`statuses/${event.statusId}`).get();
    if (!story.exists) return null;
    try { await assertStatusAccess(db, uid, story.data()!); } catch { return null; }
    if (kind === 'statusMention') {
      const mentions = story.get('mentions');
      if (story.get('authorId') !== actorUid || !Array.isArray(mentions) || !mentions.some((person: any) => person?.uid === uid)) return null;
    } else if (kind === 'statusLike') {
      if (story.get('authorId') !== uid || !(await story.ref.collection('likes').doc(actorUid).get()).exists) return null;
    } else if (kind === 'statusReply') {
      if (story.get('authorId') !== uid || typeof event.messageId !== 'string' || typeof event.conversationId !== 'string') return null;
      const [conversation, message] = await db.getAll(db.doc(`conversations/${event.conversationId}`), db.doc(`conversations/${event.conversationId}/messages/${event.messageId}`));
      const members = conversation.get('participantUids') ?? conversation.get('memberIds') ?? [];
      if (!conversation.exists || !Array.isArray(members) || !members.includes(uid) || !members.includes(actorUid) || !message.exists || message.get('deletedForEveryone') === true || message.get('senderUid') !== actorUid) return null;
    } else return null;
  } else {
    if (!['like', 'comment', 'reply', 'commentLike'].includes(kind) || typeof event.clipId !== 'string') return null;
    const clip = await db.doc(`clips/${event.clipId}`).get();
    if (!clip.exists || !(await canViewClip(db, clip.data() as ClipDoc, uid))) return null;
    if (kind === 'like') {
      if (clip.get('ownerUid') !== uid || !(await clip.ref.collection('likes').doc(actorUid).get()).exists) return null;
    } else {
      if (typeof event.commentId !== 'string') return null;
      const comment = await clip.ref.collection('comments').doc(event.commentId).get();
      if (!comment.exists || comment.get('deleted') === true) return null;
      if (kind === 'commentLike') {
        if (comment.get('authorUid') !== uid || !(await comment.ref.collection('likes').doc(actorUid).get()).exists) return null;
      } else {
        if (comment.get('authorUid') !== actorUid) return null;
        if (kind === 'comment' && clip.get('ownerUid') !== uid) return null;
        if (kind === 'reply') {
          const parentId = comment.get('parentId');
          if (typeof parentId !== 'string') return null;
          const parent = await clip.ref.collection('comments').doc(parentId).get();
          if (!parent.exists || parent.get('deleted') === true || parent.get('authorUid') !== uid) return null;
        }
      }
    }
  }
  return { id: row.id, kind, actor: await publicClipAuthor(db, actorUid),
    clipId: typeof event.clipId === 'string' ? event.clipId : null,
    commentId: typeof event.commentId === 'string' ? event.commentId : null,
    postId: typeof event.postId === 'string' ? event.postId : null,
    statusId: typeof event.statusId === 'string' ? event.statusId : null,
    messageId: typeof event.messageId === 'string' ? event.messageId : null,
    conversationId: typeof event.conversationId === 'string' ? event.conversationId : null,
    followStatus, createdAtMs: millis(event.createdAt), unread: !event.readAt };
}

export const listSocialActivity = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore();
  await assertSocialUser(db, uid);
  const config = await loadClipsConfig(db), profile = await db.doc(`clipProfiles/${uid}`).get();
  const clipsEnabled = config.enabled && profile.get('suspended') !== true;
  const limit = pageLimit(request.data?.limit), cursor = decodeClipCursor(request.data?.cursor);
  let query = db.collection(`clipProfiles/${uid}/activity`).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit);
  if (cursor) query = query.startAfter(new Timestamp(cursor[0], cursor[1]), cursor[2]);
  const rows = await query.get();
  const items = (await Promise.all(rows.docs.map(row => visibleActivity(db, row, uid, clipsEnabled)))).filter((row): row is NonNullable<typeof row> => row !== null);
  const last = rows.docs[rows.size - 1];
  return { items, nextCursor: rows.size === limit && last ? encodeClipCursor(last.get('createdAt'), last.id) : null };
});

export const markSocialActivityRead = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertSocialUser(db, uid);
  const input = request.data?.ids;
  if (!Array.isArray(input) || input.length > 30) throw new HttpsError('invalid-argument', 'activity-ids-invalid');
  const ids = [...new Set(input.map(value => clipId(value, 'activityId')))];
  if (!ids.length) return { ok: true };
  await db.runTransaction(async tx => {
    await assertSocialUser(db, uid, tx);
    const rows = await tx.getAll(...ids.map(id => db.doc(`clipProfiles/${uid}/activity/${id}`)));
    for (const row of rows) if (row.exists && !row.get('readAt')) tx.update(row.ref, { readAt: FieldValue.serverTimestamp() });
  });
  return { ok: true };
});
