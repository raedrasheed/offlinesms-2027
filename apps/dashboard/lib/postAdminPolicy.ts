import { isClipDocumentId } from './clipAdminPolicy';

export const POST_STATUSES = ['pending_review', 'published', 'rejected', 'removed'] as const;
export type PostModerationAction = 'approve' | 'reject' | 'remove';
export function postModerationTarget(status: string, action: PostModerationAction): string {
  if (action === 'approve' && status === 'pending_review') return 'published';
  if (action === 'reject' && status === 'pending_review') return 'rejected';
  if (action === 'remove' && ['pending_review', 'published', 'rejected'].includes(status)) return 'removed';
  throw new Error('This decision is no longer available. Reload the post.');
}
export function validPostImagePath(uid: unknown, postId: string, path: unknown): path is string {
  return isClipDocumentId(uid) && isClipDocumentId(postId) && typeof path === 'string'
    && path.startsWith(`postMedia/${uid}/${postId}/`)
    && /^[a-f0-9]{64}\.jpg$/.test(path.slice(`postMedia/${uid}/${postId}/`.length));
}
