// Phase 23 — pure reducer for a media message's upload lifecycle.
//
// Drives the inline progress UI (MediaUploadProgress) and the bubble's
// sent/failed state. Kept pure so the create→upload→finalize sequence in the
// outbox worker and the UI share one source of truth and it can be unit-tested.

export type UploadPhase =
  | 'pending'    // queued locally, not started
  | 'creating'   // createMediaMessage in flight
  | 'uploading'  // binary upload in flight
  | 'finalizing' // finalizeMediaMessage in flight
  | 'uploaded'   // done
  | 'failed';    // terminal-until-retry

export interface UploadState {
  phase: UploadPhase;
  progress: number; // 0..1, meaningful during 'uploading'
  error?: string;
}

export type UploadEvent =
  | { type: 'start' }
  | { type: 'created' }
  | { type: 'progress'; value: number }
  | { type: 'uploaded' }    // binary finished
  | { type: 'finalized' }
  | { type: 'fail'; error?: string }
  | { type: 'retry' };

export const initialUploadState: UploadState = { phase: 'pending', progress: 0 };

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

export function uploadReducer(state: UploadState, event: UploadEvent): UploadState {
  switch (event.type) {
    case 'start':
      return { phase: 'creating', progress: 0 };
    case 'created':
      return { phase: 'uploading', progress: state.progress };
    case 'progress':
      // Progress only applies while uploading; ignore otherwise.
      return state.phase === 'uploading'
        ? { ...state, progress: clamp01(event.value) }
        : state;
    case 'uploaded':
      return { phase: 'finalizing', progress: 1 };
    case 'finalized':
      return { phase: 'uploaded', progress: 1 };
    case 'fail':
      return { phase: 'failed', progress: state.progress, error: event.error };
    case 'retry':
      // Resume from creating; progress is recomputed by the next upload.
      return { phase: 'creating', progress: 0 };
    default:
      return state;
  }
}

/** Percent (0..100, integer) for the inline "Uploading 62%" label. */
export function uploadPercent(state: UploadState): number {
  return Math.round(clamp01(state.progress) * 100);
}
