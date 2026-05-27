// Phase 23 — voice recording state machine for the composer.
//
// idle → recording → (locked | stopped | cancelled). Owns the elapsed timer and
// the live waveform; delegates the actual capture to media/audio/audioRecorder.
// Auto-stops at the max duration. Exposes refs-free callbacks for the composer.

import { useCallback, useEffect, useRef, useState } from 'react';
import { startRecording, stopRecording, cancelRecording, RecordingResult } from '../media/audio/audioRecorder';
import { ensureMicPermission } from '../media/audio/permissions';
import { VOICE_MAX_MS } from '../media/mediaValidation';

export type RecorderMode = 'idle' | 'recording' | 'locked';

export function useVoiceRecorder() {
  const [mode, setMode] = useState<RecorderMode>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  }, []);

  useEffect(() => () => { clearTimer(); }, [clearTimer]);

  /** Begin capture. Returns false if the mic permission was denied. */
  const start = useCallback(async (): Promise<boolean> => {
    const ok = await ensureMicPermission();
    if (!ok) return false;
    setElapsedMs(0);
    setBars([]);
    await startRecording((b) => setBars(b));
    startedAt.current = Date.now();
    setMode('recording');
    clearTimer();
    timer.current = setInterval(() => {
      const e = Date.now() - startedAt.current;
      setElapsedMs(e);
      if (e >= VOICE_MAX_MS) { clearTimer(); /* caller's onMaxReached should stop+send */ }
    }, 100);
    return true;
  }, [clearTimer]);

  const lock = useCallback(() => { setMode((m) => (m === 'recording' ? 'locked' : m)); }, []);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    clearTimer();
    const res = await stopRecording();
    setMode('idle');
    setElapsedMs(0);
    setBars([]);
    return res;
  }, [clearTimer]);

  const cancel = useCallback(async (): Promise<void> => {
    clearTimer();
    setMode('idle');
    setElapsedMs(0);
    setBars([]);
    await cancelRecording();
  }, [clearTimer]);

  return { mode, elapsedMs, bars, start, stop, cancel, lock };
}
