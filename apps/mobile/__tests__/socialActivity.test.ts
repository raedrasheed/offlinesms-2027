import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/clips', () => ({ clipCall: vi.fn() }));
import { socialActivityDestination, type SocialActivityItem } from '../src/lib/socialActivity';

const item: SocialActivityItem = { id: 'event', kind: 'like', actor: { uid: 'actor', displayName: 'Person', username: 'person', photoURL: null },
  clipId: 'clip', statusId: null, messageId: null, followStatus: null, createdAtMs: 1, unread: true };
describe('Social activity navigation', () => {
  it('opens the actual clip or post rather than creating a conversation', () => {
    expect(socialActivityDestination(item)).toEqual({ screen: 'ClipViewer', params: { clipId: 'clip' } });
    expect(socialActivityDestination({ ...item, clipId: null, kind: 'postLike', postId: 'post' })).toEqual({ screen: 'PostViewer', params: { postId: 'post' } });
  });
  it('opens the specific story or its existing reply conversation using the message target', () => {
    expect(socialActivityDestination({ ...item, clipId: null, kind: 'statusMention', statusId: 'story' })).toEqual({ screen: 'StatusViewer', params: { statusId: 'story' } });
    expect(socialActivityDestination({ ...item, clipId: null, kind: 'statusReply', statusId: 'story', messageId: 'reply', conversationId: 'dm' })).toEqual({ screen: 'Conversation', params: { id: 'dm', messageId: 'reply' } });
  });
  it('routes pending follow requests to approval and accepted follows to profile', () => {
    expect(socialActivityDestination({ ...item, kind: 'follow', clipId: null, followStatus: 'pending' })).toEqual({ screen: 'ClipFollowRequests' });
    expect(socialActivityDestination({ ...item, kind: 'followAccepted', clipId: null })).toEqual({ screen: 'ClipProfile', params: { uid: 'actor' } });
  });
});
