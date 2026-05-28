// Presence service (Phase 24) — the realtime presence/activity adapter.
//
// Realtime backend = Firestore (the app's existing onSnapshot layer). This
// module owns the *lifecycle* (heartbeats, debounce, TTL refresh) and exposes a
// small, backend-agnostic API; the low-level Firestore reads/writes live in
// `lib/conversations.ts` next to the other chat data helpers.
//
// If a different realtime backend is ever added (websocket/socket), only the
// imported write/subscribe functions need swapping — the API and the hooks
// stay the same. Event-name mapping for such a backend:
//   setOnline/Offline   → presence:update
//   startTyping/stop     → presence:typing:start / presence:typing:stop
//   startRecording/stop  → presence:recording:start / presence:recording:stop

import {
  setTyping as writeTyping,
  setRecording as writeRecording,
  updateLastSeen as writeLastSeen,
  subscribeActivity,
  subscribePresence,
  ONLINE_WINDOW_MS,
} from '../lib/conversations';

const HEARTBEAT_MS = 25000;        // re-stamp lastSeen while foregrounded
const RECORDING_REFRESH_MS = 5000; // keep the recording TTL alive mid-recording

// ── current-user online/offline ─────────────────────────────────────────────
let heartbeat: ReturnType<typeof setInterval> | null = null;

/** Mark the current user online and keep a lastSeen heartbeat running. */
export async function setOnline(): Promise<void> {
  await writeLastSeen().catch(() => {});
  if (!heartbeat) heartbeat = setInterval(() => { void writeLastSeen().catch(() => {}); }, HEARTBEAT_MS);
}

/** Stop the heartbeat and freeze lastSeen at "now" (peers see it go stale). */
export async function setOffline(): Promise<void> {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  await writeLastSeen().catch(() => {});
}

export const updateLastSeen = writeLastSeen;

// ── typing ───────────────────────────────────────────────────────────────────
// writeTyping (the setTyping callable) already debounces start events and always
// emits stop, so callers can fire freely.
export function startTyping(chatId: string): void { void writeTyping(chatId, true).catch(() => {}); }
export function stopTyping(chatId: string): void { void writeTyping(chatId, false).catch(() => {}); }

// ── recording ─────────────────────────────────────────────────────────────────
let recordingChat: string | null = null;
let recordingTimer: ReturnType<typeof setInterval> | null = null;

export async function startRecording(chatId: string): Promise<void> {
  recordingChat = chatId;
  await writeRecording(chatId, true).catch(() => {});
  if (!recordingTimer) {
    recordingTimer = setInterval(() => {
      if (recordingChat) void writeRecording(recordingChat, true).catch(() => {});
    }, RECORDING_REFRESH_MS);
  }
}

export async function stopRecording(chatId: string): Promise<void> {
  if (recordingTimer) { clearInterval(recordingTimer); recordingTimer = null; }
  recordingChat = null;
  await writeRecording(chatId, false).catch(() => {});
}

// ── subscription ──────────────────────────────────────────────────────────────
export interface ChatPresence {
  /** Direct chats only: peer online/last-seen (derived from lastSeen freshness). */
  online: boolean;
  lastSeenAt: number | null;
  /** uids currently typing / recording (excludes the caller). */
  typingUids: string[];
  recordingUids: string[];
}

const EMPTY: ChatPresence = { online: false, lastSeenAt: null, typingUids: [], recordingUids: [] };

/**
 * Subscribe to a chat's presence + activity. For direct chats pass `peerUid`
 * to also receive the peer's online/last-seen. Returns an unsubscribe fn.
 */
export function subscribeToPresence(
  chatId: string,
  opts: { peerUid?: string | null },
  cb: (presence: ChatPresence) => void,
): () => void {
  let state: ChatPresence = { ...EMPTY };
  const emit = () => cb({ ...state });

  const unsubActivity = subscribeActivity(chatId, rows => {
    state = {
      ...state,
      typingUids: rows.filter(r => r.isTyping).map(r => r.uid),
      recordingUids: rows.filter(r => r.isRecording).map(r => r.uid),
    };
    emit();
  });

  let unsubPresence: (() => void) | null = null;
  if (opts.peerUid) {
    unsubPresence = subscribePresence(opts.peerUid, lastSeenAt => {
      state = {
        ...state,
        lastSeenAt,
        online: lastSeenAt != null && Date.now() - lastSeenAt < ONLINE_WINDOW_MS,
      };
      emit();
    });
  }

  return () => { try { unsubActivity(); } catch { /* noop */ } try { unsubPresence?.(); } catch { /* noop */ } };
}

/** Clear the caller's typing + recording for one chat (leave/background/logout). */
export function clearPresenceForChat(chatId: string): void {
  stopTyping(chatId);
  void stopRecording(chatId);
}
