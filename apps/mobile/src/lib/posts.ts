import { type ClipAuthor, type ClipPage, type ClipReportReason } from './clips';

export type PostAudience = 'public' | 'followers' | 'private';
export type PostItem = {
  id: string; ownerUid: string; body: string; audience: PostAudience;
  status: 'pending_review' | 'published' | 'rejected' | 'removed'; author: ClipAuthor;
  imageUrl: string | null; imageExpiresAtMs: number; createdAtMs: number; publishedAtMs: number;
  likeCount: number; commentCount: number; likedByMe: boolean; canDelete: boolean; moderationReason: string | null;
};
export type PostComment = { id: string; authorUid: string; author: ClipAuthor; text: string; createdAtMs: number; canDelete: boolean };
// Disabled locally as well as on the server, including stale screen callers.
function unavailable<T>(): Promise<T> {
  return Promise.reject(Object.assign(new Error('posts-disabled'), { code: 'functions/failed-precondition' }));
}
export const listPosts = (_args: { mode: 'feed' | 'mine'; cursor?: string; limit?: number }) => unavailable<ClipPage<PostItem>>();
export const getPost = (_postId: string) => unavailable<PostItem>();
export const createPost = (_args: { clientId: string; body: string; audience: PostAudience; imageBase64?: string }) => unavailable<PostItem>();
export const setPostLike = (_postId: string, _active: boolean) => unavailable<{likeCount: number}>();
export const deletePost = (_postId: string) => unavailable<{ok: true}>();
export const reportPost = (_args: { postId: string; reason: ClipReportReason; details?: string }) => unavailable<{ok: true}>();
export const listPostComments = (_args: { postId: string; cursor?: string; limit?: number }) => unavailable<ClipPage<PostComment>>();
export const addPostComment = (_args: { postId: string; clientId: string; text: string }) => unavailable<{commentId: string}>();
export const deletePostComment = (_postId: string, _commentId: string) => unavailable<{ok: true}>();
