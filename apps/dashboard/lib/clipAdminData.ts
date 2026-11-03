import { AggregateField, FieldPath } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { requireClipsAdmin } from './clipAdminAuth';
import { CLIP_STATUSES, clipVersion, isClipDocumentId, readClipAdminConfig, type ClipStatus } from './clipAdminPolicy';

export type AdminClipRow = {
  id: string; ownerUid: string; ownerName: string; caption: string; audience: string;
  status: ClipStatus; durationMs: number; storageBytes: number; viewCount: number;
  likeCount: number; commentCount: number; createdAtMs: number; version: string;
  moderationReason: string; processingError: string; hasMedia: boolean; publisherSuspended: boolean; publisherVersion: string;
};
export type AdminClipReport = {
  id: string; clipId: string; ownerUid: string; reporterUid: string; commentId: string | null;
  reason: string; details: string; status: string; createdAtMs: number; version: string;
  resolution: string; commentText: string; commentAuthorUid: string; commentDeleted: boolean;
};
export type AdminPage<T> = { items: T[]; nextCursor: string | null };
const PAGE_SIZE = 24;
const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const text = (v: unknown, max = 500) => typeof v === 'string' ? v.slice(0, max) : '';

async function withCursor(query: FirebaseFirestore.Query, collection: string, cursor?: string) {
  if (!cursor) return query;
  if (!isClipDocumentId(cursor)) throw new Error('Invalid page cursor. Return to the first page.');
  const anchor = await adminDb.collection(collection).doc(cursor).get();
  if (!anchor.exists || !anchor.get('createdAt')) throw new Error('This page has changed. Return to the first page.');
  return query.startAfter(anchor);
}

async function serializeClips(rows: FirebaseFirestore.QueryDocumentSnapshot[]): Promise<AdminClipRow[]> {
  const ids = [...new Set(rows.map(r => r.get('ownerUid')).filter(isClipDocumentId))];
  const users = ids.length ? await adminDb.getAll(...ids.map(uid => adminDb.collection('users').doc(uid))) : [];
  const profiles = ids.length ? await adminDb.getAll(...ids.map(uid => adminDb.collection('clipProfiles').doc(uid))) : [];
  const names = new Map(users.map(u => [u.id, text(u.get('displayName') || u.get('username'), 100)]));
  const suspended = new Map(profiles.map(p => [p.id, p.get('suspended') === true]));
  const publisherVersions = new Map(profiles.map(p => [p.id, clipVersion(p)]));
  return rows.map(row => {
    const d = row.data();
    return {
      id: row.id, ownerUid: text(d.ownerUid, 128), ownerName: names.get(d.ownerUid) ?? '',
      caption: text(d.caption, 2000), audience: text(d.audience, 20), status: d.status,
      durationMs: number(d.durationMs), storageBytes: number(d.totalStorageBytes ?? d.processedBytes ?? d.sourceSizeBytes),
      viewCount: number(d.viewCount), likeCount: number(d.likeCount), commentCount: number(d.commentCount),
      createdAtMs: d.createdAt?.toMillis?.() ?? 0, version: clipVersion(row),
      moderationReason: text(d.moderationReason), processingError: text(d.errorCode ?? d.processingError, 200),
      hasMedia: typeof d.standardPath === 'string', publisherSuspended: suspended.get(d.ownerUid) ?? false,
      publisherVersion: publisherVersions.get(d.ownerUid) ?? '',
    };
  });
}

export async function listAdminClips(input: { status?: string; ownerUid?: string; cursor?: string }): Promise<AdminPage<AdminClipRow>> {
  await requireClipsAdmin();
  let q: FirebaseFirestore.Query = adminDb.collection('clips');
  if (input.status) {
    if (!(CLIP_STATUSES as readonly string[]).includes(input.status)) throw new Error('Invalid status filter.');
    q = q.where('status', '==', input.status);
  }
  if (input.ownerUid) {
    if (!isClipDocumentId(input.ownerUid)) throw new Error('Enter a valid creator UID.');
    q = q.where('ownerUid', '==', input.ownerUid);
  }
  q = q.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  q = await withCursor(q, 'clips', input.cursor);
  const snap = await q.limit(PAGE_SIZE + 1).get();
  const rows = snap.docs.slice(0, PAGE_SIZE);
  return { items: await serializeClips(rows), nextCursor: snap.size > PAGE_SIZE ? rows[rows.length - 1].id : null };
}

export async function getAdminClip(clipId: string): Promise<AdminClipRow | null> {
  await requireClipsAdmin();
  if (!isClipDocumentId(clipId)) return null;
  const snap = await adminDb.collection('clips').doc(clipId).get();
  if (!snap.exists) return null;
  return (await serializeClips([snap as FirebaseFirestore.QueryDocumentSnapshot]))[0];
}

export async function listAdminClipReports(input: { status?: string; cursor?: string }): Promise<AdminPage<AdminClipReport>> {
  await requireClipsAdmin();
  let q: FirebaseFirestore.Query = adminDb.collection('clipReports');
  if (input.status) {
    if (!['open', 'resolved', 'dismissed'].includes(input.status)) throw new Error('Invalid report filter.');
    q = q.where('status', '==', input.status);
  }
  q = await withCursor(q.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc'), 'clipReports', input.cursor);
  const snap = await q.limit(PAGE_SIZE + 1).get();
  const rows = snap.docs.slice(0, PAGE_SIZE);
  const commentRefs = rows.filter(row => isClipDocumentId(row.get('clipId')) && isClipDocumentId(row.get('commentId')))
    .map(row => adminDb.doc(`clips/${row.get('clipId')}/comments/${row.get('commentId')}`));
  const comments = commentRefs.length ? await adminDb.getAll(...commentRefs) : [];
  const commentMap = new Map(comments.map(comment => [comment.ref.path, comment]));
  return { items: rows.map(row => {
    const d = row.data();
    const comment = commentMap.get(`clips/${d.clipId}/comments/${d.commentId}`);
    return { id: row.id, clipId: text(d.clipId, 128), ownerUid: text(d.ownerUid, 128),
      reporterUid: text(d.reporterUid, 128), commentId: typeof d.commentId === 'string' ? d.commentId : null,
      reason: text(d.reason, 30), details: text(d.details, 2000), status: text(d.status, 20),
      createdAtMs: d.createdAt?.toMillis?.() ?? 0, version: clipVersion(row), resolution: text(d.resolution),
      commentText: text(comment?.get('text'), 2000), commentAuthorUid: text(comment?.get('authorUid'), 128),
      commentDeleted: !comment?.exists || comment.get('deleted') === true,
    };
  }), nextCursor: snap.size > PAGE_SIZE ? rows[rows.length - 1].id : null };
}

export async function getClipAdminSettings() {
  await requireClipsAdmin();
  const [config, general] = await Promise.all([adminDb.doc('systemSettings/clips').get(), adminDb.doc('systemSettings/general').get()]);
  return { config: readClipAdminConfig(config.data(), text(general.get('supportEmail'), 120)), version: clipVersion(config) };
}

export async function getClipAdminStats() {
  await requireClipsAdmin();
  const clips = adminDb.collection('clips');
  const [total, published, pending, reports, storage, views] = await Promise.all([
    clips.count().get(), clips.where('status', '==', 'published').count().get(),
    clips.where('status', '==', 'pending_review').count().get(),
    adminDb.collection('clipReports').where('status', '==', 'open').count().get(),
    clips.aggregate({ value: AggregateField.sum('totalStorageBytes') }).get(),
    clips.aggregate({ value: AggregateField.sum('viewCount') }).get(),
  ]);
  return { total: total.data().count, published: published.data().count, pending: pending.data().count,
    openReports: reports.data().count, storageBytes: number(storage.data().value), views: number(views.data().value) };
}
