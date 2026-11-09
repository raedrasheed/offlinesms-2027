'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { revalidatePath } from 'next/cache';
import { adminDb } from './firebase-admin';
import { requireClipsAdmin } from './clipAdminAuth';
import { adminReason, clipVersion, isClipDocumentId, moderationTarget, parseClipAdminConfig, validateClipMediaPath, type ClipModerationAction } from './clipAdminPolicy';

export type ClipAdminActionState = { success?: boolean; error?: string } | null;
type Actor = { uid: string; email: string | null };
function audit(actor: Actor, action: string, targetId: string, metadata: Record<string, unknown>) {
  return { action, actorUid: actor.uid, actorEmail: actor.email, targetType: 'clip', targetId,
    result: 'success', metadata, createdAt: FieldValue.serverTimestamp() };
}
function assertVersion(snapshot: FirebaseFirestore.DocumentSnapshot, expected: string) {
  if (clipVersion(snapshot) !== expected) throw new Error('This item changed since you opened it. Reload before applying the action.');
}
function refresh(clipId?: string) {
  revalidatePath('/admin/clips'); revalidatePath('/admin/clips/reports');
  if (clipId) revalidatePath(`/admin/clips/${clipId}`);
}
function errorState(error: unknown): ClipAdminActionState {
  return { error: error instanceof Error ? error.message : 'The action could not be completed. Try again.' };
}

export async function saveClipSettings(_previous: ClipAdminActionState, data: FormData): Promise<ClipAdminActionState> {
  try {
    const actor = await requireClipsAdmin();
    const config = parseClipAdminConfig(data);
    const expected = String(data.get('version') ?? '');
    const ref = adminDb.doc('systemSettings/clips');
    const auditRef = adminDb.collection('auditLogs').doc();
    await adminDb.runTransaction(async tx => {
      const current = await tx.get(ref);
      assertVersion(current, expected);
      tx.set(ref, { ...config, updatedAt: FieldValue.serverTimestamp(), updatedBy: actor.uid }, { merge: true });
      tx.create(auditRef, audit(actor, 'clips.settings.updated', 'systemSettings/clips', config));
    });
    refresh(); revalidatePath('/admin/clips/settings');
    return { success: true };
  } catch (error) { return errorState(error); }
}

export async function moderateClip(input: { clipId: string; action: ClipModerationAction; reason: string; version: string }): Promise<ClipAdminActionState> {
  try {
    const actor = await requireClipsAdmin();
    if (!isClipDocumentId(input.clipId) || !['approve', 'reject', 'remove', 'suspend', 'restore'].includes(input.action)) throw new Error('Invalid moderation action.');
    const reason = adminReason(input.reason);
    const ref = adminDb.collection('clips').doc(input.clipId);
    const auditRef = adminDb.collection('auditLogs').doc();
    await adminDb.runTransaction(async tx => {
      const clip = await tx.get(ref);
      if (!clip.exists) throw new Error('Clip not found.');
      const before = clip.get('status') as string;
      const status = moderationTarget(before, input.action);
      // Replaying the same completed action is harmless. A different action on
      // an updated item must pass its exact update-time lease.
      if (before === status && clip.get('moderatedBy') === actor.uid && clip.get('moderationReason') === reason) return;
      assertVersion(clip, input.version);
      if (before === status && (input.action === 'suspend' || input.action === 'restore')) return;
      if (status === 'published' && (!validateClipMediaPath(clip.get('ownerUid'), clip.id, clip.get('standardPath'))
          || !clip.get('standardPath').endsWith('/standard.mp4'))) {
        throw new Error('Processed video is missing. This clip cannot be approved.');
      }
      const now = FieldValue.serverTimestamp();
      tx.update(ref, { status, moderationReason: reason, moderatedBy: actor.uid, moderatedAt: now, updatedAt: now,
        ...(status === 'published' && !clip.get('publishedAt') ? { publishedAt: now } : {}),
        ...(status === 'removed' ? { removedAt: now } : {}),
      });
      tx.create(auditRef, audit(actor, `clips.${input.action}`, clip.id, { from: before, to: status, reason }));
    });
    refresh(input.clipId);
    return { success: true };
  } catch (error) { return errorState(error); }
}

/** Accept only a clip id; the browser cannot supply a bucket, path or URL to
 * sign. Short leases are minted for reviewed media in the clip's own folder. */
export async function getAdminClipPreview(clipId: string): Promise<{ url?: string; expiresAtMs?: number; error?: string }> {
  try {
    const actor = await requireClipsAdmin();
    if (!isClipDocumentId(clipId)) throw new Error('Invalid clip.');
    const clip = await adminDb.collection('clips').doc(clipId).get();
    if (!clip.exists || !['pending_review', 'published', 'suspended', 'rejected'].includes(clip.get('status'))) throw new Error('This clip has no playable review copy.');
    const path = clip.get('standardPath');
    if (!validateClipMediaPath(clip.get('ownerUid'), clip.id, path) || !path.endsWith('/standard.mp4')) throw new Error('Processed video is unavailable.');
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucketName) throw new Error('The dashboard storage bucket is not configured.');
    const expiresAtMs = Date.now() + 120_000;
    const [url] = await getStorage().bucket(bucketName).file(path).getSignedUrl({
      version: 'v4', action: 'read', expires: expiresAtMs,
      responseDisposition: 'inline', responseType: 'video/mp4',
    });
    await adminDb.collection('auditLogs').add(audit(actor, 'clips.previewed', clipId, {}));
    return { url, expiresAtMs };
  } catch (error) { return { error: errorState(error)?.error }; }
}

export async function setClipPublisherSuspended(input: { uid: string; suspended: boolean; reason: string; version: string }): Promise<ClipAdminActionState> {
  try {
    const actor = await requireClipsAdmin();
    if (!isClipDocumentId(input.uid) || typeof input.suspended !== 'boolean') throw new Error('Invalid publisher.');
    const reason = adminReason(input.reason);
    const ref = adminDb.collection('clipProfiles').doc(input.uid);
    const auditRef = adminDb.collection('auditLogs').doc();
    await adminDb.runTransaction(async tx => {
      const [user, profile] = await tx.getAll(adminDb.collection('users').doc(input.uid), ref);
      if (!user.exists) throw new Error('Publisher not found.');
      if (!input.suspended && (profile.get('deleting') === true || profile.get('deletedAccount') === true)) {
        throw new Error('An account being deleted cannot have Clips access restored.');
      }
      if (profile.get('suspended') === input.suspended) return;
      assertVersion(profile, input.version);
      tx.set(ref, { suspended: input.suspended, suspensionReason: reason,
        suspensionChangedBy: actor.uid, suspensionChangedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.create(auditRef, audit(actor, input.suspended ? 'clips.publisher.suspended' : 'clips.publisher.restored', input.uid, { reason }));
    });
    refresh();
    return { success: true };
  } catch (error) { return errorState(error); }
}

export async function resolveClipReport(input: {
  reportId: string; version: string; decision: 'resolved' | 'dismissed';
  action: 'none' | 'remove_clip' | 'remove_comment' | 'suspend_publisher'; reason: string;
}): Promise<ClipAdminActionState> {
  try {
    const actor = await requireClipsAdmin();
    if (!isClipDocumentId(input.reportId) || !['resolved', 'dismissed'].includes(input.decision)
        || !['none', 'remove_clip', 'remove_comment', 'suspend_publisher'].includes(input.action)
        || (input.decision === 'dismissed' && input.action !== 'none')) throw new Error('Invalid report action.');
    const reason = adminReason(input.reason);
    const reportRef = adminDb.collection('clipReports').doc(input.reportId);
    const auditRef = adminDb.collection('auditLogs').doc();
    await adminDb.runTransaction(async tx => {
      const report = await tx.get(reportRef);
      if (!report.exists) throw new Error('Report not found.');
      if (report.get('status') !== 'open') {
        if (report.get('resolvedBy') === actor.uid && report.get('status') === input.decision
            && report.get('resolution') === reason && report.get('resolutionAction') === input.action) return;
        throw new Error('This report was already handled. Reload the page.');
      }
      assertVersion(report, input.version);
      const clipId = report.get('clipId');
      if (!isClipDocumentId(clipId)) throw new Error('Report references an invalid clip.');
      const clipRef = adminDb.collection('clips').doc(clipId);
      const clip = await tx.get(clipRef);
      const ownerUid = clip.get('ownerUid');
      let comment: FirebaseFirestore.DocumentSnapshot | null = null;
      let parent: FirebaseFirestore.DocumentSnapshot | null = null;
      if (input.action === 'remove_comment') {
        const commentId = report.get('commentId');
        if (!isClipDocumentId(commentId)) throw new Error('This report does not identify a comment.');
        comment = await tx.get(clipRef.collection('comments').doc(commentId));
        const parentId = comment.get('parentId');
        if (isClipDocumentId(parentId)) parent = await tx.get(clipRef.collection('comments').doc(parentId));
      }
      if (input.action !== 'none' && !clip.exists) throw new Error('Clip no longer exists. Resolve without an additional action.');
      if (input.action === 'suspend_publisher' && !isClipDocumentId(ownerUid)) throw new Error('Publisher not found.');
      const now = FieldValue.serverTimestamp();
      if (input.action === 'remove_clip' && clip.get('status') !== 'removed') {
        moderationTarget(clip.get('status'), 'remove');
        tx.update(clipRef, { status: 'removed', removedAt: now, updatedAt: now, moderatedAt: now,
          moderatedBy: actor.uid, moderationReason: reason });
      }
      if (input.action === 'remove_comment' && comment?.exists && comment.get('deleted') !== true) {
        tx.update(comment.ref, { deleted: true, text: '', deletedAt: now, deletedBy: actor.uid, updatedAt: now });
        tx.update(clipRef, { commentCount: Math.max(0, Number(clip.get('commentCount') ?? 0) - 1), updatedAt: now });
        if (parent?.exists) tx.update(parent.ref, { replyCount: Math.max(0, Number(parent.get('replyCount') ?? 0) - 1), updatedAt: now });
      }
      if (input.action === 'suspend_publisher') {
        tx.set(adminDb.collection('clipProfiles').doc(ownerUid), { suspended: true, suspensionReason: reason,
          suspensionChangedBy: actor.uid, suspensionChangedAt: now }, { merge: true });
      }
      tx.update(reportRef, { status: input.decision, resolution: reason, resolutionAction: input.action,
        resolvedBy: actor.uid, resolvedAt: now, updatedAt: now });
      tx.create(auditRef, audit(actor, 'clips.report.resolved', clipId, {
        reportId: input.reportId, decision: input.decision, action: input.action, reason,
      }));
    });
    refresh();
    return { success: true };
  } catch (error) { return errorState(error); }
}
