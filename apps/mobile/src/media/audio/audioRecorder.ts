// Phase 23 — voice recorder wrapper around expo-av Audio.Recording.
//
// Single active recording at a time. Enables metering so the UI can draw a live
// waveform; restores the audio mode after stopping. Background recording is not
// enabled. Returns the local file uri + duration + normalized waveform on stop.

import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { WaveformSampler } from './waveform';

export interface RecordingResult {
  uri: string;
  durationMs: number;
  sizeBytes: number;
  mimeType: string;
  waveform: number[];
}

let recording: Audio.Recording | null = null;
let sampler: WaveformSampler | null = null;
let startedAt = 0;

async function setRecordingMode(on: boolean): Promise<void> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: on,
    playsInSilentModeIOS: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: true,
  });
}

/** Start recording. `onSample` receives a 0..1 live waveform array. */
export async function startRecording(onSample?: (bars: number[]) => void): Promise<void> {
  if (recording) { try { await recording.stopAndUnloadAsync(); } catch { /* noop */ } recording = null; }
  await setRecordingMode(true);
  sampler = new WaveformSampler();
  const rec = new Audio.Recording();
  await rec.prepareToRecordAsync({
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  rec.setProgressUpdateInterval(100);
  rec.setOnRecordingStatusUpdate((st) => {
    if (st.isRecording && sampler) {
      sampler.push((st as any).metering);
      onSample?.(sampler.live());
    }
  });
  await rec.startAsync();
  startedAt = Date.now();
  recording = rec;
}

/** Stop + finalize. Returns null if nothing was recording. */
export async function stopRecording(mimeType = 'audio/m4a'): Promise<RecordingResult | null> {
  if (!recording) return null;
  const rec = recording;
  recording = null;
  const elapsed = startedAt > 0 ? Date.now() - startedAt : 0;
  let durationMs = 0;
  try {
    const status = await rec.stopAndUnloadAsync();
    durationMs = status.durationMillis ?? 0;
  } catch { /* best-effort */ }
  // status.durationMillis is unreliable right after stop on some devices; fall
  // back to the wall-clock elapsed time so short notes aren't rejected.
  if (!durationMs || durationMs < elapsed - 200) durationMs = elapsed;
  await setRecordingMode(false).catch(() => {});
  const uri = rec.getURI();
  const waveform = sampler?.finalize() ?? [];
  sampler = null;
  if (!uri) return null;
  let sizeBytes = 0;
  try { const info = await FileSystem.getInfoAsync(uri); sizeBytes = (info as any).size ?? 0; } catch { /* noop */ }
  return { uri, durationMs, sizeBytes, mimeType, waveform };
}

/** Cancel: stop and delete the temp file, discarding everything. */
export async function cancelRecording(): Promise<void> {
  if (!recording) { sampler = null; await setRecordingMode(false).catch(() => {}); return; }
  const rec = recording;
  recording = null;
  sampler = null;
  let uri: string | null = null;
  try { await rec.stopAndUnloadAsync(); uri = rec.getURI(); } catch { /* noop */ }
  await setRecordingMode(false).catch(() => {});
  if (uri) { try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch { /* noop */ } }
}

export function isRecording(): boolean { return recording != null; }
