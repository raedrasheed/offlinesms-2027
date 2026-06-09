// Pure routing helpers for tapped push notifications — no native imports, so
// they load under vitest. Used by App.tsx to dispatch a notification tap to
// the right screen / external URL.

export type PushRoute = {
  conversationId?: string;
  requestId?: string;
  broadcastId?: string;
  type?: string;
  route?: string;
  /** Phase 28 — admin broadcast on-tap action. */
  actionType?: 'open_app' | 'open_chat' | 'open_group' | 'open_campaign' | 'open_url' | 'none';
  actionTarget?: string;
};

/** Extract the navigation target from a notification's data payload, or null. */
export function routeFromNotification(data: unknown): PushRoute | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const hasTarget =
    typeof d.conversationId === 'string' ||
    typeof d.requestId === 'string' ||
    typeof d.broadcastId === 'string' ||
    typeof d.actionType === 'string';
  if (!hasTarget) return null;
  return {
    conversationId: typeof d.conversationId === 'string' ? d.conversationId : undefined,
    requestId:      typeof d.requestId      === 'string' ? d.requestId      : undefined,
    broadcastId:    typeof d.broadcastId    === 'string' ? d.broadcastId    : undefined,
    type:           typeof d.type           === 'string' ? d.type           : undefined,
    route:          typeof d.route          === 'string' ? d.route          : undefined,
    actionType:     typeof d.actionType     === 'string' ? d.actionType as PushRoute['actionType'] : undefined,
    actionTarget:   typeof d.actionTarget   === 'string' ? d.actionTarget   : undefined,
  };
}

// ─── Tap-dispatch decision (pure) ──────────────────────────────────────────

export type PushDispatch =
  | { kind: 'screen'; name: 'Conversation'; params: { id: string } }
  | { kind: 'screen'; name: 'JoinRequests'; params: { id: string } }
  | { kind: 'screen'; name: 'Tabs' }
  | { kind: 'url';    href: string }
  | { kind: 'none' };

/**
 * Decide what to do when a notification is tapped. Pure so the dispatcher in
 * App.tsx can be unit-tested via this helper without RN runtime.
 *
 * Priority:
 *   1. Phase 26 group-join request → JoinRequests for that conversation.
 *   2. Phase 28 admin_broadcast → action-type-driven (open_url / open_chat
 *      / open_group → matching screen or URL; open_app/none → home tab).
 *   3. Any other payload with a conversationId → Conversation.
 */
export function dispatchForRoute(route: PushRoute | null): PushDispatch {
  if (!route) return { kind: 'none' };

  if (route.type === 'group_join_request' && route.conversationId) {
    return { kind: 'screen', name: 'JoinRequests', params: { id: route.conversationId } };
  }

  if (route.type === 'admin_broadcast') {
    switch (route.actionType) {
      case 'open_url':
        return route.actionTarget && /^https?:\/\//.test(route.actionTarget)
          ? { kind: 'url', href: route.actionTarget }
          : { kind: 'screen', name: 'Tabs' };
      case 'open_chat':
        return route.actionTarget
          ? { kind: 'screen', name: 'Conversation', params: { id: route.actionTarget } }
          : { kind: 'screen', name: 'Tabs' };
      case 'open_group':
        return route.actionTarget
          ? { kind: 'screen', name: 'Conversation', params: { id: route.actionTarget } }
          : { kind: 'screen', name: 'Tabs' };
      case 'open_app':
      case 'none':
      default:
        return { kind: 'screen', name: 'Tabs' };
    }
  }

  if (route.conversationId) {
    return { kind: 'screen', name: 'Conversation', params: { id: route.conversationId } };
  }
  return { kind: 'none' };
}
