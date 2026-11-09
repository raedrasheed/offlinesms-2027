import { FieldPath } from 'firebase-admin/firestore';
import { requireStatusesAdmin } from './clipAdminAuth';
import { isClipDocumentId } from './clipAdminPolicy';
import { adminDb } from './firebase-admin';

const PAGE_SIZE = 24;
const text = (value: unknown) => typeof value === 'string' ? value : '';
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;

export function statusModerationVersion(row: FirebaseFirestore.DocumentSnapshot): string {
  const changed = row.get('moderatedAt') as FirebaseFirestore.Timestamp | undefined;
  return changed ? `${changed.seconds}:${changed.nanoseconds}` : '';
}

function toRow(row: FirebaseFirestore.DocumentSnapshot, now: number) {
  const status = row.data()!;
  const expiresAt = (status.expiresAt as FirebaseFirestore.Timestamp | undefined)?.toMillis?.() ?? 0;
  const type: 'text' | 'image' | 'video' = status.type === 'video' || status.type === 'image' ? status.type : 'text';
  return {
    id: row.id,
    authorId: text(status.authorId),
    authorName: text(status.authorName),
    type,
    audience: text(status.audienceType) || 'all_contacts',
    createdAt: (status.createdAt as FirebaseFirestore.Timestamp | undefined)?.toMillis?.() ?? 0,
    expiresAt,
    expired: expiresAt <= now,
    suspended: status.moderationSuspended === true,
    views: count(status.viewCount),
    likes: count(status.likeCount),
  };
}

export async function listAdminStatuses(authorId?: string, cursor?: string) {
  await requireStatusesAdmin();
  const collection = adminDb.collection('statuses');
  let query = collection.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (authorId) {
    if (!isClipDocumentId(authorId)) throw new Error('Enter a valid author UID.');
    query = query.where('authorId', '==', authorId);
  }
  if (cursor) {
    if (!isClipDocumentId(cursor)) throw new Error('Invalid page cursor.');
    const anchor = await collection.doc(cursor).get();
    if (!anchor.exists || !anchor.get('createdAt') || (authorId && anchor.get('authorId') !== authorId)) {
      throw new Error('This page has changed. Return to the first page.');
    }
    query = query.startAfter(anchor);
  }
  const snapshot = await query.limit(PAGE_SIZE + 1).get();
  const now = Date.now();
  const items = snapshot.docs.slice(0, PAGE_SIZE).map(row => toRow(row, now));
  return { items, nextCursor: snapshot.size > PAGE_SIZE ? items[PAGE_SIZE - 1].id : null };
}

export async function getAdminStatus(id: string) {
  await requireStatusesAdmin();
  if (!isClipDocumentId(id)) return null;
  const row = await adminDb.collection('statuses').doc(id).get();
  if (!row.exists) return null;
  return {
    ...toRow(row, Date.now()),
    body: text(row.get('body')).slice(0, 700),
    version: statusModerationVersion(row),
  };
}
