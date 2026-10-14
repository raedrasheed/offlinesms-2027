// Pure banner selection for SyncStatusBanner (kept free of React Native so it
// can be unit-tested in node).
import type { FocusState, LiveState } from '../../hooks/useLocalConversation';

export type SyncBannerKind = 'loading-message' | 'waiting-network' | 'missing' | 'error' | 'sync-error' | 'offline' | null;

/** Pure: which banner to show (unit-tested). */
export function syncBannerKind(focus: FocusState | null, live: LiveState): SyncBannerKind {
  if (focus) {
    switch (focus.state) {
      case 'locating': case 'pending': case 'fetching': return live === 'offline' ? 'waiting-network' : 'loading-message';
      case 'waiting-network': return 'waiting-network';
      case 'missing': return 'missing';
      case 'error': return 'error';
      case 'ready': break;
    }
  }
  if (live === 'error') return 'sync-error';
  if (live === 'offline') return 'offline';
  return null;
}

