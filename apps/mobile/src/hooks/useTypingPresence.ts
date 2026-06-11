// Composer typing presence (Phase 24).
//
// Publishes typing=true while the user edits the draft, auto-stops after a
// debounce window, and stops immediately when the draft is cleared (send/clear)
// or the chat is left/disabled. The underlying setTyping callable rate-limits
// start events, so this only needs to manage the stop timing.

import { useEffect, useRef } from 'react';
import { startTyping, stopTyping } from '../services/presenceService';

const STOP_AFTER_MS = 3500;

export function useTypingPresence(
  chatId: string | undefined,
  text: string,
  enabled = true,
): void {
  const active = enabled && !!chatId;
  const wasTyping = useRef(false);

  useEffect(() => {
    if (!active || !chatId) return;
    const hasText = text.trim().length > 0;

    if (!hasText) {
      if (wasTyping.current) { wasTyping.current = false; stopTyping(chatId); }
      return;
    }

    wasTyping.current = true;
    startTyping(chatId);
    const handle = setTimeout(() => { wasTyping.current = false; stopTyping(chatId); }, STOP_AFTER_MS);
    return () => clearTimeout(handle);
  }, [text, chatId, active]);

  // Stop on unmount / chat change / when disabled.
  useEffect(() => {
    if (!chatId) return;
    return () => { if (wasTyping.current) { wasTyping.current = false; stopTyping(chatId); } };
  }, [chatId]);
}
