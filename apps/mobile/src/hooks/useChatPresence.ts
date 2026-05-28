// Chat presence view-model (Phase 24).
//
// Subscribes to a chat's presence + activity and returns the raw state. The
// header turns it into a subtitle via `formatPresenceSubtitle`, keeping i18n /
// name resolution in the screen layer (where member names already live).

import { useEffect, useState } from 'react';
import { subscribeToPresence, type ChatPresence } from '../services/presenceService';

// Minimal shape of react-i18next's `t` (avoids a hard dep on i18next types).
type TFunction = (key: string, opts?: Record<string, unknown>) => string;

const EMPTY: ChatPresence = { online: false, lastSeenAt: null, typingUids: [], recordingUids: [] };

export function useChatPresence(
  chatId: string | undefined,
  peerUid: string | null | undefined,
): ChatPresence {
  const [presence, setPresence] = useState<ChatPresence>(EMPTY);
  useEffect(() => {
    if (!chatId) { setPresence(EMPTY); return; }
    setPresence(EMPTY);
    return subscribeToPresence(chatId, { peerUid: peerUid ?? null }, setPresence);
  }, [chatId, peerUid]);
  return presence;
}

function lastSeenLabel(t: TFunction, lastSeenAt: number): string {
  const d = new Date(lastSeenAt);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return t('presence.lastSeen', { time: sameDay ? time : `${d.toLocaleDateString()} ${time}` });
}

/**
 * Build the header subtitle. Activity (recording > typing) takes priority over
 * online/last-seen. `nameFor` resolves a uid to a display name (groups).
 */
export function formatPresenceSubtitle(
  presence: ChatPresence,
  opts: { isGroup: boolean; t: TFunction; nameFor?: (uid: string) => string; groupFallback?: string },
): string {
  const { isGroup, t, nameFor, groupFallback } = opts;
  const name = (uid: string) => (nameFor ? nameFor(uid) : uid.slice(0, 6));

  if (presence.recordingUids.length > 0) {
    if (!isGroup) return t('presence.recording');
    return t('presence.isRecording', { name: name(presence.recordingUids[0]) });
  }
  if (presence.typingUids.length > 0) {
    if (!isGroup) return t('presence.typing');
    if (presence.typingUids.length === 1) return t('presence.isTyping', { name: name(presence.typingUids[0]) });
    return t('presence.typingMulti', { name: name(presence.typingUids[0]), count: presence.typingUids.length - 1 });
  }
  if (isGroup) return groupFallback ?? '';
  if (presence.online) return t('presence.online');
  if (presence.lastSeenAt) return lastSeenLabel(t, presence.lastSeenAt);
  return '';
}
