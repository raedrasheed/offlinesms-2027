import { clipCall, type ClipAuthor, type ClipPage } from './clips';

export type SocialActivityItem = {
  id: string;
  kind: 'like' | 'comment' | 'reply' | 'commentLike' | 'follow' | 'followAccepted' | 'statusMention' | 'statusLike' | 'statusReply' | 'postLike' | 'postComment';
  actor: ClipAuthor; clipId: string | null; postId?: string | null; statusId: string | null; messageId: string | null;
  conversationId?: string | null; followStatus: 'pending' | 'accepted' | null; createdAtMs: number; unread: boolean;
};
const isPostActivity = (item: SocialActivityItem) => !!item.postId || item.kind === 'postLike' || item.kind === 'postComment';
export const listSocialActivity = async (args: { cursor?: string; limit?: number } = {}) => {
  const page = await clipCall<ClipPage<SocialActivityItem>>('listSocialActivity', args);
  return { ...page, items: page.items.filter(item => !isPostActivity(item)) };
};
export const markSocialActivityRead = (ids: string[]) => clipCall<{ ok: true }>('markSocialActivityRead', { ids });

export function socialActivityDestination(item: SocialActivityItem): { screen: string; params?: Record<string, string> } | null {
  if (isPostActivity(item)) return null;
  if (item.kind === 'statusReply' && item.conversationId && item.messageId) return { screen: 'Conversation', params: { id: item.conversationId, messageId: item.messageId } };
  if (item.kind === 'follow' && item.followStatus === 'pending') return { screen: 'ClipFollowRequests' };
  if (item.clipId) return { screen: 'ClipViewer', params: { clipId: item.clipId } };
  if (item.statusId) return { screen: 'StatusViewer', params: { statusId: item.statusId } };
  return { screen: 'ClipProfile', params: { uid: item.actor.uid } };
}
