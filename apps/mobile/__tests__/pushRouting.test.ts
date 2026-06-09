import { describe, it, expect } from 'vitest';
import { routeFromNotification } from '../src/lib/pushRouting';

describe('routeFromNotification', () => {
  it('routes a chat message to its conversation', () => {
    expect(routeFromNotification({ type: 'chat_message', conversationId: 'c1', messageId: 'm1', route: 'Conversation' }))
      .toMatchObject({ conversationId: 'c1', type: 'chat_message', route: 'Conversation' });
  });
  it('routes a join request', () => {
    expect(routeFromNotification({ type: 'group_join_request', conversationId: 'g1', requestId: 'r1' }))
      .toMatchObject({ conversationId: 'g1', requestId: 'r1', type: 'group_join_request' });
  });
  it('returns null when there is no navigable target', () => {
    expect(routeFromNotification({ type: 'misc' })).toBeNull();
    expect(routeFromNotification(null)).toBeNull();
    expect(routeFromNotification('nope')).toBeNull();
  });
});
