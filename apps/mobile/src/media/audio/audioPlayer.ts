// Phase 23 — single-instance voice playback (expo-av Audio.Sound).
//
// Only one voice note plays at a time: starting a new one stops the current.
// Subscribers get progress + finished events so bubbles can show a playhead.

import { Audio, AVPlaybackStatus } from 'expo-av';

export interface PlaybackState {
  id: string | null;     // which message is playing
  playing: boolean;
  positionMs: number;
  durationMs: number;
}

type Listener = (state: PlaybackState) => void;

let sound: Audio.Sound | null = null;
let currentId: string | null = null;
const listeners = new Set<Listener>();

function emit(state: PlaybackState): void {
  for (const l of listeners) l(state);
}

export function subscribePlayback(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

async function unload(): Promise<void> {
  if (sound) { try { await sound.unloadAsync(); } catch { /* noop */ } sound = null; }
  currentId = null;
}

/** Toggle playback for a message. Tapping the playing one pauses it; tapping a
 *  different one stops the current and plays the new. `onStart` fires the first
 *  time a given message begins (used to mark the played receipt). */
export async function togglePlay(id: string, uri: string, onStart?: () => void): Promise<void> {
  if (currentId === id && sound) {
    const st = await sound.getStatusAsync();
    if (st.isLoaded && st.isPlaying) { await sound.pauseAsync(); emitFrom(st, false); return; }
    if (st.isLoaded) { await sound.playAsync(); return; }
  }
  await unload();
  await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
  const { sound: snd } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
  sound = snd;
  currentId = id;
  onStart?.();
  snd.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    emit({
      id: currentId,
      playing: status.isPlaying,
      positionMs: status.positionMillis ?? 0,
      durationMs: status.durationMillis ?? 0,
    });
    if (status.didJustFinish) { void unload(); emit({ id: null, playing: false, positionMs: 0, durationMs: 0 }); }
  });
}

function emitFrom(status: AVPlaybackStatus, playing: boolean): void {
  if (!status.isLoaded) return;
  emit({ id: currentId, playing, positionMs: status.positionMillis ?? 0, durationMs: status.durationMillis ?? 0 });
}

export async function stopPlayback(): Promise<void> {
  await unload();
  emit({ id: null, playing: false, positionMs: 0, durationMs: 0 });
}
