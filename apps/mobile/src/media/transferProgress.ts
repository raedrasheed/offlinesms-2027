// In-memory media transfer progress (upload + download), keyed by message id.
//
// Progress ticks must not churn the SQLite DB or trigger full conversation
// re-reads, so live progress lives here and components subscribe directly
// (same pattern as the audio player). The persistent failed/uploaded state
// still lives on the message row; this store only drives the live % and the
// transient "downloading"/"failed-just-now" UI.

export type TransferKind = 'upload' | 'download';
export interface TransferState { kind: TransferKind; progress: number; failed: boolean }

const states = new Map<string, TransferState>();
type Listener = (id: string) => void;
const listeners = new Set<Listener>();
function emit(id: string): void { for (const l of listeners) l(id); }

export function subscribeTransfer(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getTransfer(id: string): TransferState | undefined {
  return states.get(id);
}

export function setTransferProgress(id: string, kind: TransferKind, progress: number): void {
  states.set(id, { kind, progress: Math.max(0, Math.min(1, progress)), failed: false });
  emit(id);
}

export function setTransferFailed(id: string, kind: TransferKind): void {
  const prev = states.get(id);
  states.set(id, { kind, progress: prev?.progress ?? 0, failed: true });
  emit(id);
}

export function clearTransfer(id: string): void {
  if (states.delete(id)) emit(id);
}
