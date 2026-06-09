import { describe, it, expect } from 'vitest';
import { routeFromNotification, dispatchForRoute } from '../src/lib/pushRouting';

describe('routeFromNotification', () => {
  it('routes a chat message to its conversation', () => {
    expect(routeFromNotification({ type: 'chat_message', conversationId: 'c1', messageId: 'm1', route: 'Conversation' }))
      .toMatchObject({ conversationId: 'c1', type: 'chat_message', route: 'Conversation' });
  });
  it('routes a join request', () => {
    expect(routeFromNotification({ type: 'group_join_request', conversationId: 'g1', requestId: 'r1' }))
      .toMatchObject({ conversationId: 'g1', requestId: 'r1', type: 'group_join_request' });
  });
  it('extracts admin_broadcast actionType/actionTarget/broadcastId', () => {
    const r = routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b1', actionType: 'open_url', actionTarget: 'https://x.com' });
    expect(r).toMatchObject({ type: 'admin_broadcast', broadcastId: 'b1', actionType: 'open_url', actionTarget: 'https://x.com' });
  });
  it('returns null when there is no navigable target', () => {
    expect(routeFromNotification({ type: 'misc' })).toBeNull();
    expect(routeFromNotification(null)).toBeNull();
    expect(routeFromNotification('nope')).toBeNull();
  });
});

describe('dispatchForRoute (tap-dispatch)', () => {
  it('returns none for a null route', () => {
    expect(dispatchForRoute(null)).toEqual({ kind: 'none' });
  });
  it('join request → JoinRequests screen', () => {
    expect(dispatchForRoute(routeFromNotification({ type: 'group_join_request', conversationId: 'g1' })))
      .toEqual({ kind: 'screen', name: 'JoinRequests', params: { id: 'g1' } });
  });
  it('chat_message → Conversation', () => {
    expect(dispatchForRoute(routeFromNotification({ type: 'chat_message', conversationId: 'c1' })))
      .toEqual({ kind: 'screen', name: 'Conversation', params: { id: 'c1' } });
  });

  it('admin_broadcast open_url → URL', () => {
    expect(dispatchForRoute(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'open_url', actionTarget: 'https://x.com' })))
      .toEqual({ kind: 'url', href: 'https://x.com' });
  });
  it('admin_broadcast open_url with missing/invalid target falls back to Tabs', () => {
    expect(dispatchForRoute(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'open_url' })))
      .toEqual({ kind: 'screen', name: 'Tabs' });
    expect(dispatchForRoute(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'open_url', actionTarget: 'ftp://x' })))
      .toEqual({ kind: 'screen', name: 'Tabs' });
  });
  it('admin_broadcast open_chat → Conversation', () => {
    expect(dispatchForRoute(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'open_chat', actionTarget: 'c9' })))
      .toEqual({ kind: 'screen', name: 'Conversation', params: { id: 'c9' } });
  });
  it('admin_broadcast open_group → Conversation (groups live there)', () => {
    expect(dispatchForRoute(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'open_group', actionTarget: 'g9' })))
      .toEqual({ kind: 'screen', name: 'Conversation', params: { id: 'g9' } });
  });
  it('admin_broadcast open_app / none → Tabs', () => {
    expect(dispatchForRoute(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'open_app' })))
      .toEqual({ kind: 'screen', name: 'Tabs' });
    expect(dispatchForRoute(routeFromNotification({ type: 'admin_broadcast', broadcastId: 'b', actionType: 'none' })))
      .toEqual({ kind: 'screen', name: 'Tabs' });
  });
});
