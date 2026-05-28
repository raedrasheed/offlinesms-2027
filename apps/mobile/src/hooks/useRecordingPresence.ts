// Recording presence (Phase 24).
//
// Mirrors the voice recorder's lifecycle to presence: publishes recording=true
// while the recorder is active (recording or locked) and recording=false when
// it stops, cancels, sends, or the chat is left. Pass `recording` derived from
// the existing recorder mode — this hook adds no audio logic of its own.

import { useEffect, useRef } from 'react';
import { startRecording, stopRecording } from '../services/presenceService';

export function useRecordingPresence(chatId: string | undefined, recording: boolean): void {
  const wasRecording = useRef(false);

  useEffect(() => {
    if (!chatId) return;
    if (recording && !wasRecording.current) {
      wasRecording.current = true;
      void startRecording(chatId);
    } else if (!recording && wasRecording.current) {
      wasRecording.current = false;
      void stopRecording(chatId);
    }
  }, [recording, chatId]);

  // Safety net: clear on unmount / chat change if still flagged.
  useEffect(() => {
    if (!chatId) return;
    return () => { if (wasRecording.current) { wasRecording.current = false; void stopRecording(chatId); } };
  }, [chatId]);
}
