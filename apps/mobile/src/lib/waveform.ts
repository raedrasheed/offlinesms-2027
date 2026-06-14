// Pure waveform helpers — no React-Native imports so vitest can load it.

/**
 * Resample a normalized (0..1) waveform to exactly `n` bars by bucketing and
 * keeping each bucket's PEAK (max), so transient spikes stay visible instead
 * of being averaged away. Returns the input untouched when it already fits.
 */
export function resampleWaveform(data: number[], n: number): number[] {
  if (n <= 0) return [];
  if (data.length <= n) return data;
  const out = new Array<number>(n);
  const bucket = data.length / n;
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * bucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * bucket));
    let max = 0;
    for (let j = start; j < end && j < data.length; j++) {
      if (data[j] > max) max = data[j];
    }
    out[i] = max;
  }
  return out;
}
