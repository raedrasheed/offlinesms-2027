// Clips use callable reads: Firestore rules must not expose private feed rows.
// Playback leases are requested separately and are never persisted in messages.
import { getFunctions, httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import { app, auth } from './firebase';
import { createClipTermsGate } from './clipTerms';
import { confirmClipTerms } from './clipTermsPrompt';

export type ClipAudience = 'public' | 'followers' | 'group' | 'private';
export type ClipStatus = 'uploading' | 'processing' | 'pending_review' | 'published' | 'rejected' | 'removed' | 'failed';
export type ClipFollowStatus = 'none' | 'pending' | 'accepted';
export type ClipAuthor = { uid: string; displayName: string; username: string; photoURL: string | null; privateAccount?: boolean };
export type ClipItem = {
  id: string; ownerUid: string; caption: string; hashtags: string[]; audience: ClipAudience;
  groupId: string | null; status: ClipStatus; allowComments: boolean; allowDownload: boolean;
  durationMs: number; width: number; height: number; createdAtMs: number; publishedAtMs: number;
  likeCount: number; commentCount: number; viewCount: number; shareCount: number;
  likedByMe: boolean; savedByMe: boolean; followStatus?: ClipFollowStatus; author: ClipAuthor;
  thumbnailUrl?: string;
};
export type ClipProfile = ClipAuthor & {
  bio: string; privateAccount: boolean; followerCount: number; followingCount: number;
  clipCount: number; likeCount: number; followStatus: ClipFollowStatus; isOwner: boolean; blocked: boolean;
};
export type ClipsConfig = {
  enabled: boolean; moderationRequired: boolean; maxDurationSeconds: number; maxUploadMB: number;
  maxDailyUploads: number; termsVersion: string; supportEmail: string;
};
export type ClipComment = {
  id: string; authorUid: string; author: ClipAuthor; text: string; parentId: string | null;
  createdAtMs: number; likeCount: number; likedByMe: boolean; replyCount: number; deleted: boolean; canDelete: boolean;
};
export type ClipFollowRequest = ClipAuthor & { createdAtMs: number };
export type ClipFeedMode = 'forYou' | 'following' | 'saved' | 'profile';
export type ClipPage<T> = { items: T[]; nextCursor: string | null };
export type ClipFeedInput = { mode: ClipFeedMode; ownerUid?: string; query?: string; cursor?: string; limit?: number };
export type ClipPlayback = { url: string | null; thumbnailUrl: string; expiresAtMs: number; durationMs: number; quality: 'standard' | 'dataSaver' };
export type ClipReportReason = 'spam' | 'abuse' | 'sexual' | 'violence' | 'copyright' | 'other';
async function rawClipCall<R>(name: string, args: Record<string, unknown> = {}): Promise<R> {
  return (await httpsCallable<Record<string, unknown>, R>(getFunctions(app, 'us-central1'), name)(args)).data;
}
const withClipTerms = createClipTermsGate({
  getUid: () => auth.currentUser?.uid,
  loadTerms: () => rawClipCall<{config: ClipsConfig; termsAccepted: boolean}>('getClipsConfig'),
  acceptTerms: (version,expectedUid) => rawClipCall('acceptClipsTerms', {version,expectedUid}),
  confirm: confirmClipTerms,
  watchAccount: callback => onAuthStateChanged(auth, user => callback(user?.uid)),
});
// Only deliberate actions may open a consent dialog. Feed reads, playback,
// background analytics, and the acceptance endpoint itself never prompt.
const interactiveCalls = new Set([
  'updateClipProfile', 'followClipCreator', 'respondClipFollowRequest', 'removeClipFollower',
  'setClipInteraction', 'reportClip', 'addClipComment', 'deleteClipComment', 'setClipCommentLike',
  'updateClip', 'deleteClip', 'shareClip',
]);
export function clipCall<R>(name: string, args: Record<string, unknown> = {}): Promise<R> {
  const invoke = () => rawClipCall<R>(name, args);
  return interactiveCalls.has(name) ? withClipTerms(invoke) : invoke();
}
export const getClipsConfig = () => clipCall<{config: ClipsConfig; termsAccepted: boolean}>('getClipsConfig');
export const acceptClipsTerms = (version: string) => {
  const expectedUid=auth.currentUser?.uid;
  return clipCall<{ok: true}>('acceptClipsTerms', {version,...(expectedUid?{expectedUid}:{})});
};
export const getClipsFeed = (args: ClipFeedInput) => clipCall<ClipPage<ClipItem>>('getClipsFeed', {...args});
export const getClip = async (clipId: string) => (await clipCall<{clip: ClipItem}>('getClip', {clipId})).clip;
export const getClipProfile = async (uid: string) => (await clipCall<{profile: ClipProfile}>('getClipProfile', {uid})).profile;
export const updateClipProfile = async (args: {bio?: string; privateAccount?: boolean}) => (await clipCall<{profile: ClipProfile}>('updateClipProfile', args)).profile;
export const followClipCreator = (uid: string, following: boolean) => clipCall<{status: ClipFollowStatus}>('followClipCreator', {uid, following});
export const listClipFollowRequests = (args: {cursor?: string; limit?: number} = {}) => clipCall<ClipPage<ClipFollowRequest>>('listClipFollowRequests', args);
export const listClipFollowers = (args: {cursor?: string; limit?: number} = {}) => clipCall<ClipPage<ClipFollowRequest>>('listClipFollowers', args);
export const respondClipFollowRequest = (uid: string, accept: boolean) => clipCall<{ok: true}>('respondClipFollowRequest', {uid, accept});
export const removeClipFollower = (uid: string) => clipCall<{ok: true}>('removeClipFollower', {uid});
export const setClipInteraction = (clipId: string, type: 'like' | 'save' | 'hide', active: boolean) => clipCall<{ok: true; likeCount: number}>('setClipInteraction', {clipId, type, active});
export const recordClipView = (clipId: string) => clipCall<{ok: true}>('recordClipView', {clipId});
export const reportClip = (args: {clipId: string; commentId?: string; reason: ClipReportReason; details?: string}) => clipCall<{ok: true; reportId: string}>('reportClip', args);
export const listClipComments = (args: {clipId: string; parentId?: string; cursor?: string; limit?: number}) => clipCall<ClipPage<ClipComment>>('listClipComments', args);
export const addClipComment = (args: {clipId: string; text: string; parentId?: string; clientId: string}) => clipCall<{commentId: string}>('addClipComment', args);
export const deleteClipComment = (clipId: string, commentId: string) => clipCall<{ok: true}>('deleteClipComment', {clipId, commentId});
export const setClipCommentLike = (clipId: string, commentId: string, active: boolean) => clipCall<{ok: true; likeCount: number}>('setClipCommentLike', {clipId, commentId, active});
export const updateClip = async (args: {clipId: string; caption?: string; audience?: ClipAudience; groupId?: string | null; allowComments?: boolean; allowDownload?: boolean}) => (await clipCall<{clip: ClipItem}>('updateClip', args)).clip;
export const deleteClip = (clipId: string) => clipCall<{ok: true}>('deleteClip', {clipId});
export const shareClip = (args: {clipId: string; conversationId: string; clientId: string}) => clipCall<{messageId: string}>('shareClip', args);
export const getClipPlayback = (args: {clipId: string; quality?: 'standard' | 'dataSaver'; download?: boolean; thumbnailOnly?: boolean}) => clipCall<ClipPlayback>('getClipPlayback', args);
export const getClipThumbnails = (clipIds: string[]) => clipCall<{items: Array<{clipId: string; thumbnailUrl: string; expiresAtMs: number}>}>('getClipThumbnails', {clipIds});

/** Stable public app links never contain a signed media lease. */
export function clipLink(id: string): string { return `https://offlinesms.com/clips/${encodeURIComponent(id)}`; }
