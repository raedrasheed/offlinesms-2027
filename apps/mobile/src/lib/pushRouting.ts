// Pure routing helper for tapped push notifications — no native imports, so it
// loads under vitest.

export type PushRoute = {
  conversationId?: string;
  requestId?: string;
  type?: string;
  route?: string;
};

/** Extract the navigation target from a notification's data payload, or null. */
export function routeFromNotification(data: unknown): PushRoute | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.conversationId !== 'string' && typeof d.requestId !== 'string') return null;
  return {
    conversationId: typeof d.conversationId === 'string' ? d.conversationId : undefined,
    requestId: typeof d.requestId === 'string' ? d.requestId : undefined,
    type: typeof d.type === 'string' ? d.type : undefined,
    route: typeof d.route === 'string' ? d.route : undefined,
  };
}
