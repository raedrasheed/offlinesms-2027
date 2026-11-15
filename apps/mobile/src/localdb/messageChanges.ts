// Local mutations can finish without a Firestore snapshot (especially offline).
type Listener = (conversationId: string, queuedDelivery?: boolean) => void;
const listeners = new Set<Listener>();
export function onLocalMessagesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitLocalMessagesChanged(conversationId: string, queuedDelivery?: boolean): void {
  for (const listener of listeners) {
    try {
      if (queuedDelivery) listener(conversationId, true);
      else listener(conversationId);
    } catch { /* a UI listener must not fail a committed write */ }
  }
}
