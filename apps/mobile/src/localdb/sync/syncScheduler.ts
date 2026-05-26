// Phase 22 — sync scheduler. Decides WHEN to run the engine: app start, auth
// change, network online, app foreground, new outbox item, and a foreground-
// only timer. Pauses on background to protect battery.

import { AppState, AppStateStatus } from 'react-native';
import { startNetworkWatch, onConnectivityChange } from './networkState';
import { syncNow } from './syncEngine';

const FOREGROUND_INTERVAL_MS = 45_000;

let timer: ReturnType<typeof setInterval> | null = null;
let stopNet: (() => void) | null = null;
let stopConn: (() => void) | null = null;
let appStateSub: { remove: () => void } | null = null;
let activeConversationId: string | undefined;

export function setActiveConversation(id?: string): void {
  activeConversationId = id;
}

function startTimer(): void {
  if (timer) return;
  timer = setInterval(() => { void syncNow('timer', activeConversationId); }, FOREGROUND_INTERVAL_MS);
}

function stopTimer(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

function onAppState(state: AppStateStatus): void {
  if (state === 'active') {
    startTimer();
    void syncNow('foreground', activeConversationId);
  } else {
    stopTimer();
  }
}

/** Start the scheduler. Call once after the user's local DB is opened. */
export function startScheduler(): void {
  stopNet = startNetworkWatch();
  stopConn = onConnectivityChange(online => { if (online) void syncNow('online', activeConversationId); });
  appStateSub = AppState.addEventListener('change', onAppState);
  startTimer();
  void syncNow('boot', activeConversationId);
}

/** Stop the scheduler (logout / teardown). */
export function stopScheduler(): void {
  stopTimer();
  stopNet?.(); stopNet = null;
  stopConn?.(); stopConn = null;
  appStateSub?.remove(); appStateSub = null;
  activeConversationId = undefined;
}

/** Kick a sync immediately, e.g. right after enqueuing an outbox item. */
export function kick(reason: 'outbox' | 'manual' = 'manual'): void {
  void syncNow(reason, activeConversationId);
}
