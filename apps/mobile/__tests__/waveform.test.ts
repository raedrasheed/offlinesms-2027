import { describe, it, expect } from 'vitest';
import { resampleWaveform } from '../src/lib/waveform';

describe('resampleWaveform', () => {
  it('returns the input untouched when it already fits', () => {
    const data = [0.1, 0.5, 0.9];
    expect(resampleWaveform(data, 3)).toBe(data);
    expect(resampleWaveform(data, 10)).toBe(data);
  });

  it('downsamples to exactly n bars', () => {
    const data = Array.from({ length: 200 }, (_, i) => (i % 10) / 10);
    expect(resampleWaveform(data, 40)).toHaveLength(40);
    expect(resampleWaveform(data, 1)).toHaveLength(1);
  });

  it('keeps bucket peaks so spikes stay visible', () => {
    // One loud spike in an otherwise quiet take must survive downsampling.
    const data = new Array(100).fill(0.05);
    data[57] = 1;
    const out = resampleWaveform(data, 10);
    expect(Math.max(...out)).toBe(1);
  });

  it('handles degenerate sizes', () => {
    expect(resampleWaveform([], 5)).toEqual([]);
    expect(resampleWaveform([0.4], 0)).toEqual([]);
    expect(resampleWaveform([0.4, 0.8], -1)).toEqual([]);
  });
});
