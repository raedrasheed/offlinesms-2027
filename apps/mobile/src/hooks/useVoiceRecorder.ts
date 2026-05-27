// Phase 23 — voice recording state machine for the composer.
//
// idle → recording → (locked | stopped | cancelled). Owns the elapsed timer and
// the live waveform; delegates capture to media/audio/audioRecorder. Tracks
// duration as accumulated running time so pausing (locked mode) doesn't count,
// and so a real note isn't rejected when status.durationMillis is unreliable.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startRecording, stopRecording, cancelRecording, pauseRecording, resumeRecording, RecordingResult,
} from '../media/audio/audioRecorder';
import { ensureMicPermission } from '../media/audio/permissions';
import { VOICE_MAX_MS } from '../media/mediaValidation';

export type RecorderMode = 'idle' | 'recording' | 'locked';

export function useVoiceRecorder() {
  const [mode, setMode] = useState<RecorderMode>('idle');
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [bars, setBars] = useState<number[]>([]);
  const accum = useRef(0);       // ms accumulated before the current running segment
  const segStart = useRef(0);    // wall-clock start of the current running segment
  const pausedRef = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
  }, []);

  const duration = useCallback(
    () => accum.current + (pausedRef.current ? 0 : Date.now() - segStart.current),
    [],
  );

  useEffect(() => () => { clearTimer(); }, [clearTimer]);

  const start = useCallback(async (): Promise<boolean> => {
    const ok = await ensureMicPermission();
    if (!ok) return false;
    setElapsedMs(0);
    setBars([]);
    accum.current = 0;
    pausedRef.current = false;
    setPaused(false);
    await startRecording((b) => setBars(b));
    segStart.current = Date.now();
    setMode('recording');
    clearTimer();
    timer.current = setInterval(() => {
      const e = duration();
      setElapsedMs(e);
      if (e >= VOICE_MAX_MS) clearTimer();
    }, 100);
    return true;
  }, [clearTimer, duration]);

  const lock = useCallback(() => { setMode((m) => (m === 'recording' ? 'locked' : m)); }, []);

  const togglePause = useCallback(async () => {
    if (pausedRef.current) {
      segStart.current = Date.now();
      pausedRef.current = false;
      setPaused(false);
      await resumeRecording();
    } else {
      accum.current += Date.now() - segStart.current;
      pausedRef.current = true;
      setPaused(true);
      await pauseRecording();
    }
  }, []);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    clearTimer();
    const finalMs = duration();
    const res = await stopRecording();
    setMode('idle');
    setPaused(false);
    pausedRef.current = false;
    setElapsedMs(0);
    setBars([]);
    if (!res) return null;
    // Prefer our pause-aware wall-clock duration over the unreliable native one.
    return { ...res, durationMs: Math.max(res.durationMs || 0, finalMs) };
  }, [clearTimer, duration]);

  const cancel = useCallback(async (): Promise<void> => {
    clearTimer();
    setMode('idle');
    setPaused(false);
    pausedRef.current = false;
    setElapsedMs(0);
    setBars([]);
    await cancelRecording();
  }, [clearTimer]);

  return { mode, paused, elapsedMs, bars, start, stop, cancel, lock, togglePause };
}
