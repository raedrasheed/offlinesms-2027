type Listener = (conversationId: string, uid: string | null) => void;
const listeners = new Set<Listener>();
export function onExternalMembersChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitExternalMembersChanged(conversationId: string, uid: string | null): void {
  for (const listener of listeners) {
    try { listener(conversationId, uid); } catch { /* a screen cannot fail a durable mutation */ }
  }
}
