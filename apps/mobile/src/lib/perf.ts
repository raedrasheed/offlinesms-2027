// Lightweight performance markers for on-device measurement.
//
// Marks are timestamps (ms) relative to JS bundle start, kept in a small ring
// buffer. In development builds each mark is logged ("[perf] name +1234ms"),
// and `perfReport()` returns the buffer so a debug screen / adb log capture can
// read: app start → auth ready → first chat-list render → conversation open →
// first local render → notification tap → target message visible.
// No-ops cost a few object allocations; nothing is sent anywhere.

const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;

export interface PerfMark { name: string; at: number; data?: Record<string, unknown> }

const MAX = 200;
// Logged in development, and in test builds made with EXPO_PUBLIC_PERF_LOG=1
// (on-device measurement: `adb logcat | grep '\[perf\]'`). Off in store builds.
const LOG = (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_PERF_LOG === '1';
const marks: PerfMark[] = [];
const firsts = new Map<string, number>();

export function perfMark(name: string, data?: Record<string, unknown>): number {
  const at = Math.round(now());
  marks.push({ name, at, data });
  if (marks.length > MAX) marks.shift();
  if (!firsts.has(name)) firsts.set(name, at);
  if (LOG) {
    // eslint-disable-next-line no-console
    console.log(`[perf] ${name} +${at}ms${data ? ' ' + JSON.stringify(data) : ''}`);
  }
  return at;
}

/** Elapsed ms between the FIRST occurrences of two marks, or null. */
export function perfSpan(from: string, to: string): number | null {
  const a = firsts.get(from), b = firsts.get(to);
  return a != null && b != null ? b - a : null;
}

export function perfReport(): PerfMark[] {
  return marks.slice();
}
