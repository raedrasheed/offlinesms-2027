import { clipCall, type ClipAuthor, type ClipPage } from './clips';

export type SocialActivityItem = {
  id: string;
  kind: 'like' | 'comment' | 'reply' | 'commentLike' | 'follow' | 'followAccepted' | 'statusMention' | 'statusLike' | 'statusReply' | 'postLike' | 'postComment';
  actor: ClipAuthor; clipId: string | null; postId?: string | null; statusId: string | null; messageId: string | null;
  conversationId?: string | null; followStatus: 'pending' | 'accepted' | null; createdAtMs: number; unread: boolean;
};
export const listSocialActivity = (args: { cursor?: string; limit?: number } = {}) => clipCall<ClipPage<SocialActivityItem>>('listSocialActivity', args);
export const markSocialActivityRead = (ids: string[]) => clipCall<{ ok: true }>('markSocialActivityRead', { ids });

export function socialActivityDestination(item: SocialActivityItem): { screen: string; params?: Record<string, string> } {
  if (item.kind === 'statusReply' && item.conversationId && item.messageId) return { screen: 'Conversation', params: { id: item.conversationId, messageId: item.messageId } };
  if (item.kind === 'follow' && item.followStatus === 'pending') return { screen: 'ClipFollowRequests' };
  if (item.postId) return { screen: 'PostViewer', params: { postId: item.postId } };
  if (item.clipId) return { screen: 'ClipViewer', params: { clipId: item.clipId } };
  if (item.statusId) return { screen: 'StatusViewer', params: { statusId: item.statusId } };
  return { screen: 'ClipProfile', params: { uid: item.actor.uid } };
}
