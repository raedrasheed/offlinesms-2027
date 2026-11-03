import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { requireClipsAdmin } from './clipAdminAuth';
import { clipVersion, isClipDocumentId } from './clipAdminPolicy';
import { POST_STATUSES } from './postAdminPolicy';

export type AdminPost = {id: string; ownerUid: string; body: string; status: string; audience: string; hasImage: boolean;
  createdAtMs: number; likeCount: number; commentCount: number; moderationReason: string; version: string};
const str = (v: unknown, max = 2200) => typeof v === 'string' ? v.slice(0, max) : '';
function serialize(row: FirebaseFirestore.DocumentSnapshot): AdminPost {
  return { id: row.id, ownerUid: str(row.get('ownerUid'), 128), body: str(row.get('body')), status: str(row.get('status'), 30),
    audience: str(row.get('audience'), 30), hasImage: !!row.get('imagePath'), createdAtMs: row.get('createdAt')?.toMillis?.() ?? 0,
    likeCount: Number(row.get('likeCount')) || 0, commentCount: Number(row.get('commentCount')) || 0,
    moderationReason: str(row.get('moderationReason'), 500), version: clipVersion(row) };
}
export async function getAdminPost(id: string): Promise<AdminPost | null> {
  await requireClipsAdmin();
  if (!isClipDocumentId(id)) return null;
  const row = await adminDb.collection('posts').doc(id).get();
  return row.exists ? serialize(row) : null;
}
export async function listAdminPosts(status: string, cursor?: string) {
  await requireClipsAdmin();
  if (!(POST_STATUSES as readonly string[]).includes(status)) throw new Error('Invalid post status.');
  let query: FirebaseFirestore.Query = adminDb.collection('posts').where('status', '==', status)
    .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (cursor) {
    if (!isClipDocumentId(cursor)) throw new Error('Invalid page cursor.');
    const anchor = await adminDb.collection('posts').doc(cursor).get();
    if (!anchor.exists || anchor.get('status') !== status) throw new Error('This page changed. Return to the first page.');
    query = query.startAfter(anchor);
  }
  const page = await query.limit(25).get(), rows = page.docs.slice(0, 24);
  return { items: rows.map(serialize), nextCursor: page.size > 24 ? rows[23].id : null };
}
export async function listOpenPostReports(cursor?: string) {
  await requireClipsAdmin();
  let query: FirebaseFirestore.Query = adminDb.collection('postReports').where('status', '==', 'open')
    .orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (cursor) {
    if (!isClipDocumentId(cursor)) throw new Error('Invalid report cursor.');
    const anchor = await adminDb.collection('postReports').doc(cursor).get();
    if (!anchor.exists || anchor.get('status') !== 'open') throw new Error('The reports changed. Return to the first page.');
    query = query.startAfter(anchor);
  }
  const page = await query.limit(25).get(), rows = page.docs.slice(0, 24);
  return { items: rows.map(row => ({ id: row.id, postId: str(row.get('postId'), 128), reason: str(row.get('reason'), 40),
    details: str(row.get('details'), 2000), version: clipVersion(row) })), nextCursor: page.size > 24 ? rows[23].id : null };
}
