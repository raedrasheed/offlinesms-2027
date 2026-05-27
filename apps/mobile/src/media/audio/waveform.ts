// Phase 23 — waveform sampling helpers.
//
// expo-av metering is in dBFS (roughly -160..0). Convert to a 0..1 linear
// amplitude for the live bars, then downsample to a fixed bar count for storage
// via normalizeWaveform (shared with validation). Cosmetic — never throws.

import { normalizeWaveform, WAVEFORM_MAX_BARS } from '../mediaValidation';

export { normalizeWaveform, WAVEFORM_MAX_BARS };

/** Map a dBFS metering value (negative) to a 0..1 amplitude. */
export function dbToAmplitude(db: number | undefined | null): number {
  if (db == null || !Number.isFinite(db)) return 0;
  // -60 dB (near silence) → 0, 0 dB (max) → 1.
  const floor = -60;
  if (db <= floor) return 0;
  if (db >= 0) return 1;
  return (db - floor) / (0 - floor);
}

/** Accumulate live samples, capped so memory stays bounded on long recordings. */
export class WaveformSampler {
  private samples: number[] = [];
  private readonly cap: number;
  constructor(cap = 600) { this.cap = cap; }
  push(db: number | undefined | null): void {
    if (this.samples.length >= this.cap) this.samples.shift();
    this.samples.push(dbToAmplitude(db));
  }
  /** Recent bars for the live UI (already 0..1). */
  live(bars = WAVEFORM_MAX_BARS): number[] {
    return normalizeWaveform(this.samples, bars);
  }
  /** Final normalized waveform to persist with the message. */
  finalize(bars = WAVEFORM_MAX_BARS): number[] {
    return normalizeWaveform(this.samples, bars);
  }
  reset(): void { this.samples = []; }
}
