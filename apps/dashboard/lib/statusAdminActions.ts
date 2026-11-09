'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { revalidatePath } from 'next/cache';
import { requireStatusesAdmin } from './clipAdminAuth';
import { adminReason, isClipDocumentId } from './clipAdminPolicy';
import { adminDb } from './firebase-admin';
import { statusModerationVersion } from './statusAdminData';

export async function moderateStatus(input: { id: string; suspended: boolean; reason: string; version: string }) {
  try {
    const actor = await requireStatusesAdmin();
    if (!isClipDocumentId(input.id) || typeof input.suspended !== 'boolean') throw new Error('Invalid status action.');
    const reason = adminReason(input.reason);
    const ref = adminDb.collection('statuses').doc(input.id);
    const audit = adminDb.collection('auditLogs').doc();
    await adminDb.runTransaction(async tx => {
      const row = await tx.get(ref);
      if (!row.exists) throw new Error('Status not found.');
      if ((row.get('expiresAt')?.toMillis?.() ?? 0) <= Date.now()) throw new Error('This status has expired.');
      if ((row.get('moderationSuspended') === true) === input.suspended) return;
      if (statusModerationVersion(row) !== input.version) {
        throw new Error('Another moderator updated this status. Reload and try again.');
      }
      const now = FieldValue.serverTimestamp();
      tx.update(ref, { moderationSuspended: input.suspended, moderatedAt: now });
      tx.create(audit, {
        action: input.suspended ? 'statuses.suspended' : 'statuses.restored', actorUid: actor.uid, actorEmail: actor.email,
        targetType: 'status', targetId: row.id, result: 'success', metadata: { reason }, createdAt: now,
      });
    });
    revalidatePath('/admin/statuses');
    revalidatePath(`/admin/statuses/${input.id}`);
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not update status.' };
  }
}

export async function getAdminStatusPreview(id: string) {
  try {
    const actor = await requireStatusesAdmin();
    if (!isClipDocumentId(id)) throw new Error('Invalid status.');
    const row = await adminDb.collection('statuses').doc(id).get();
    if (!row.exists) throw new Error('Status not found.');
    const author = row.get('authorId');
    const path = row.get('storagePath');
    const mime = row.get('mimeType');
    const type = row.get('type');
    const allowed = type === 'image' ? ['image/jpeg', 'image/png', 'image/webp']
      : type === 'video' ? ['video/mp4', 'video/quicktime', 'video/webm'] : [];
    if (!isClipDocumentId(author) || typeof path !== 'string' || !path.startsWith(`statuses/${author}/`)
        || !isClipDocumentId(path.slice(`statuses/${author}/`.length)) || !allowed.includes(mime)) {
      throw new Error('This status has no reviewable media.');
    }
    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucket) throw new Error('The dashboard storage bucket is not configured.');
    const [url] = await getStorage().bucket(bucket).file(path).getSignedUrl({
      version: 'v4', action: 'read', expires: Date.now() + 120_000, responseDisposition: 'inline', responseType: mime,
    });
    await adminDb.collection('auditLogs').add({
      action: 'statuses.previewed', actorUid: actor.uid, actorEmail: actor.email,
      targetType: 'status', targetId: id, result: 'success', metadata: {}, createdAt: FieldValue.serverTimestamp(),
    });
    return { url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not load preview.' };
  }
}
