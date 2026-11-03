import { clipCall, type ClipAuthor, type ClipPage, type ClipReportReason } from './clips';

export type PostAudience = 'public' | 'followers' | 'private';
export type PostItem = {
  id: string; ownerUid: string; body: string; audience: PostAudience;
  status: 'pending_review' | 'published' | 'rejected' | 'removed'; author: ClipAuthor;
  imageUrl: string | null; imageExpiresAtMs: number; createdAtMs: number; publishedAtMs: number;
  likeCount: number; commentCount: number; likedByMe: boolean; canDelete: boolean; moderationReason: string | null;
};
export type PostComment = { id: string; authorUid: string; author: ClipAuthor; text: string; createdAtMs: number; canDelete: boolean };
// Signed image URLs are short-lived view state, never stored in drafts or messages.
export const listPosts = (args: { mode: 'feed' | 'mine'; cursor?: string; limit?: number }) => clipCall<ClipPage<PostItem>>('listPosts', args);
export const getPost = async (postId: string) => (await clipCall<{post: PostItem}>('getPost', { postId })).post;
export const createPost = async (args: { clientId: string; body: string; audience: PostAudience; imageBase64?: string }) =>
  (await clipCall<{post: PostItem}>('createPost', args)).post;
export const setPostLike = (postId: string, active: boolean) => clipCall<{likeCount: number}>('setPostLike', { postId, active });
export const deletePost = (postId: string) => clipCall<{ok: true}>('deletePost', { postId });
export const reportPost = (args: { postId: string; reason: ClipReportReason; details?: string }) => clipCall<{ok: true}>('reportPost', args);
export const listPostComments = (args: { postId: string; cursor?: string; limit?: number }) => clipCall<ClipPage<PostComment>>('listPostComments', args);
export const addPostComment = (args: { postId: string; clientId: string; text: string }) => clipCall<{commentId: string}>('addPostComment', args);
export const deletePostComment = (postId: string, commentId: string) => clipCall<{ok: true}>('deletePostComment', { postId, commentId });
