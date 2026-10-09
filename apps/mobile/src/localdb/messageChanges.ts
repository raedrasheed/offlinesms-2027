// Local mutations can finish without a Firestore snapshot (especially offline).
type Listener = (conversationId: string) => void;
const listeners = new Set<Listener>();
export function onLocalMessagesChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitLocalMessagesChanged(conversationId: string): void {
  for (const listener of listeners) listener(conversationId);
}
