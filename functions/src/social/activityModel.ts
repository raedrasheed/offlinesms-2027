import { POSTS_ENABLED } from './postsFeature';
import { createHash } from 'node:crypto';
import { FieldValue, type Firestore, type DocumentReference } from 'firebase-admin/firestore';

export type SocialActivityKind = 'like' | 'comment' | 'reply' | 'commentLike' | 'follow' | 'followAccepted' | 'statusMention' | 'statusLike' | 'statusReply' | 'postLike' | 'postComment';
export type SocialActivityEvent = {
  kind: SocialActivityKind; actorUid: string; clipId?: string; commentId?: string; statusId?: string; messageId?: string; postId?: string; conversationId?: string;
};

/** Stable keys keep retried social mutations from duplicating inbox entries. */
export function socialActivityId(event: SocialActivityEvent): string {
  return createHash('sha256').update(JSON.stringify([event.kind, event.actorUid, event.clipId ?? '', event.commentId ?? '', event.statusId ?? '', event.messageId ?? '', event.postId ?? ''])).digest('hex');
}

/** Called only after the social mutation's authorization reads, in its transaction.
 * Store references, never copied captions, media leases, phone numbers or names.
 */
export function writeSocialActivity(db: Firestore, tx: { set(ref: DocumentReference, data: Record<string, unknown>): unknown; delete(ref: DocumentReference): unknown }, recipientUid: string, event: SocialActivityEvent, active = true): void {
  if (!recipientUid || recipientUid === event.actorUid) return;
  if (!POSTS_ENABLED && active && (event.postId || event.kind === 'postLike' || event.kind === 'postComment')) return;
  const ref = db.doc(`clipProfiles/${recipientUid}/activity/${socialActivityId(event)}`);
  if (!active) { tx.delete(ref); return; }
  tx.set(ref, { ...event, createdAt: FieldValue.serverTimestamp(), readAt: null });
}
