'use server';

import { assertPostsEnabled } from './postsFeature';
import { FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { revalidatePath } from 'next/cache';
import { adminDb } from './firebase-admin';
import { requireClipsAdmin } from './clipAdminAuth';
import { adminReason, clipVersion, isClipDocumentId } from './clipAdminPolicy';
import { postModerationTarget, validPostImagePath, type PostModerationAction } from './postAdminPolicy';

export type PostAdminResult = { success?: boolean; error?: string };
function resultError(error: unknown): PostAdminResult {
  return { error: error instanceof Error ? error.message : 'The action failed. Try again.' };
}
function audit(actor: {uid: string; email: string | null}, action: string, id: string, metadata: Record<string, unknown>) {
  return { actorUid: actor.uid, actorEmail: actor.email, action, targetType: 'post', targetId: id,
    result: 'success', metadata, createdAt: FieldValue.serverTimestamp() };
}
export async function moderatePost(input: {postId: string; version: string; action: PostModerationAction; reason: string}): Promise<PostAdminResult> {
  try {
    const actor = await requireClipsAdmin();
    assertPostsEnabled();
    if (!isClipDocumentId(input.postId) || !['approve', 'reject', 'remove'].includes(input.action)) throw new Error('Invalid post action.');
    const reason = adminReason(input.reason);
    const ref = adminDb.collection('posts').doc(input.postId), auditRef = adminDb.collection('auditLogs').doc();
    await adminDb.runTransaction(async tx => {
      const post = await tx.get(ref);
      if (!post.exists) throw new Error('Post not found.');
      if (clipVersion(post) !== input.version) throw new Error('This post changed. Reload before applying the decision.');
      const before = String(post.get('status')), status = postModerationTarget(before, input.action);
      if (status === 'published') {
        const uid = post.get('ownerUid');
        if (!isClipDocumentId(uid)) throw new Error('Invalid creator.');
        const [user, profile] = await tx.getAll(adminDb.doc(`users/${uid}`), adminDb.doc(`clipProfiles/${uid}`));
        if (!user.exists || ['deleted', 'disabled', 'suspended', 'banned'].includes(user.get('status'))
            || user.get('disabled') === true || profile.get('suspended') === true || profile.get('deleting') === true || profile.get('deletedAccount') === true) {
          throw new Error('This creator cannot publish.');
        }
        const path = post.get('imagePath');
        if (path != null && !validPostImagePath(uid, post.id, path)) throw new Error('The post image is invalid.');
        if (!(typeof post.get('body') === 'string' && post.get('body').trim()) && !path) throw new Error('This post is empty.');
      }
      const now = FieldValue.serverTimestamp();
      tx.update(ref, { status, moderationReason: reason, moderatedBy: actor.uid, moderatedAt: now, updatedAt: now,
        ...(status === 'published' ? { publishedAt: now } : {}), ...(status === 'removed' ? { removedAt: now } : {}) });
      tx.create(auditRef, audit(actor, `posts.${input.action}`, post.id, { from: before, to: status, reason }));
    });
    revalidatePath('/admin/posts'); revalidatePath(`/admin/posts/${input.postId}`);
    return { success: true };
  } catch (error) { return resultError(error); }
}
export async function getAdminPostImage(postId: string): Promise<{url?: string; expiresAtMs?: number; error?: string}> {
  try {
    const actor = await requireClipsAdmin();
    assertPostsEnabled();
    if (!isClipDocumentId(postId)) throw new Error('Invalid post.');
    const post = await adminDb.collection('posts').doc(postId).get();
    const path = post.get('imagePath');
    if (!post.exists || !['pending_review', 'published', 'rejected'].includes(post.get('status'))
        || !validPostImagePath(post.get('ownerUid'), post.id, path)) throw new Error('No review image is available.');
    const bucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
    if (!bucket) throw new Error('The dashboard storage bucket is not configured.');
    const expiresAtMs = Date.now() + 120_000;
    const [url] = await getStorage().bucket(bucket).file(path).getSignedUrl({ version: 'v4', action: 'read', expires: expiresAtMs,
      responseDisposition: 'inline', responseType: 'image/jpeg' });
    await adminDb.collection('auditLogs').add(audit(actor, 'posts.previewed', postId, {}));
    return { url, expiresAtMs };
  } catch (error) { return resultError(error); }
}
export async function resolvePostReport(input: {reportId: string; version: string; decision: 'resolved' | 'dismissed'; reason: string}): Promise<PostAdminResult> {
  try {
    const actor = await requireClipsAdmin();
    assertPostsEnabled();
    if (!isClipDocumentId(input.reportId) || !['resolved', 'dismissed'].includes(input.decision)) throw new Error('Invalid report action.');
    const reason = adminReason(input.reason), ref = adminDb.collection('postReports').doc(input.reportId), auditRef = adminDb.collection('auditLogs').doc();
    await adminDb.runTransaction(async tx => {
      const report = await tx.get(ref);
      if (!report.exists || report.get('status') !== 'open' || clipVersion(report) !== input.version) throw new Error('This report changed. Reload the page.');
      const postId = report.get('postId');
      if (!isClipDocumentId(postId)) throw new Error('Invalid report target.');
      tx.update(ref, { status: input.decision, resolution: reason, resolvedBy: actor.uid, resolvedAt: FieldValue.serverTimestamp() });
      tx.create(auditRef, audit(actor, `posts.report.${input.decision}`, postId, { reportId: report.id, reason }));
    });
    revalidatePath('/admin/posts'); return { success: true };
  } catch (error) { return resultError(error); }
}
