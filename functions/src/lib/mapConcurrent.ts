/** Bound external IO without abandoning siblings after one failure. Every
 * item is attempted and all workers settle before the caller retries. */
export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('invalid-concurrency');
  const results: R[] = new Array(items.length);
  const failures: unknown[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try { results[index] = await work(items[index]); }
      catch (error) { failures.push(error); }
    }
  }));
  if (failures.length) throw failures[0];
  return results;
}
