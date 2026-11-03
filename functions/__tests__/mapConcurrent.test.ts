import { describe, expect, it } from 'vitest';
import { mapConcurrent } from '../src/lib/mapConcurrent';

describe('bounded fan-out workers', () => {
  it('bounds simultaneous work and returns every result in input order', async () => {
    let running = 0, peak = 0;
    const rows = Array.from({ length: 301 }, (_, i) => i);
    const result = await mapConcurrent(rows, 8, async value => {
      peak = Math.max(peak, ++running);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      running--;
      return value * 2;
    });
    expect(peak).toBe(8);
    expect(running).toBe(0);
    expect(result).toEqual(rows.map(i => i * 2));
  });
  it('waits for every worker and attempts later recipients before rejecting for retry', async () => {
    const seen: number[] = [];
    await expect(mapConcurrent([0, 1, 2, 3, 4, 5], 2, async value => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      seen.push(value);
      if (value === 1) throw new Error('temporary transport failure');
      return value;
    })).rejects.toThrow('temporary transport failure');
    expect(seen.sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
