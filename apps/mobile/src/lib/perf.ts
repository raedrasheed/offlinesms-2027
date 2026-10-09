// On-device timing for test builds. THE SAME FILE ships in the baseline and the
// updated test build (scripts/test-builds/), and both call it at the same
// screen-level points, so before/after numbers are comparable:
//
//   mark  auth:resolved            first auth state known          (App)
//   mark  chatList:shown           chat list first has rows        (ChatsList)
//   span  conversation_open        open → first messages rendered  (Conversation)
//   span  push_to_visible          notification tap → that message in the rendered list
//   span  send_to_visible          send tap → own message in the rendered list
//   span  older_to_visible         "load older" → more messages in the rendered list
//
// "Rendered" = present in the array handed to the conversation's FlatList.
// Output (EXPO_PUBLIC_PERF_LOG=1 builds, or development): logcat lines
//   [perf] mark <name> +<ms since JS start>
//   [perf] span <name> <ms>
// Nothing is sent anywhere; store builds log nothing.

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const t0 = clock();
const LOG = (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_PERF_LOG === '1';

export interface PerfEntry { kind: 'mark' | 'span'; name: string; ms: number; data?: Record<string, unknown> }

const MAX = 200;
const entries: PerfEntry[] = [];
const once = new Set<string>();

function record(e: PerfEntry) {
  entries.push(e);
  if (entries.length > MAX) entries.shift();
  if (LOG) {
    // eslint-disable-next-line no-console
    console.log(`[perf] ${e.kind} ${e.name} ${e.kind === 'mark' ? '+' : ''}${e.ms}${e.data ? ' ' + JSON.stringify(e.data) : ''}`);
  }
}

/** A point in time (ms since JS start). `onlyFirst` records it once per process. */
export function perfMark(name: string, data?: Record<string, unknown>, onlyFirst = false): void {
  if (onlyFirst) { if (once.has(name)) return; once.add(name); }
  record({ kind: 'mark', name, ms: Math.round(clock() - t0), data });
}

interface Pending { start: number; id?: string; minCount?: number; lastNot?: string }
const pending = new Map<string, Pending>();

/** Current clock, to start a span before its target id is known. */
export function perfNow(): number {
  return clock();
}

/**
 * Start a span that ends when the conversation list renders: the message
 * `id` (if given); or at least `minCount` rows whose last (oldest) row is no
 * longer `lastNot` (older messages loaded); or any rows at all.
 */
export function perfBegin(
  span: string,
  target: { id?: string | null; minCount?: number; lastNot?: string } = {},
  startedAt: number = clock(),
): void {
  pending.set(span, { start: startedAt, id: target.id ?? undefined, minCount: target.minCount, lastNot: target.lastNot });
}

/** Report what the conversation list renders (newest first); ends matching spans. */
export function perfObserve(ids: readonly string[]): void {
  if (pending.size === 0) return;
  for (const [span, p] of pending) {
    const done = p.id ? ids.includes(p.id)
      : p.minCount != null ? ids.length >= p.minCount && ids[ids.length - 1] !== p.lastNot
        : ids.length > 0;
    if (done) {
      pending.delete(span);
      record({ kind: 'span', name: span, ms: Math.round(clock() - p.start) });
    }
  }
}

export function perfReport(): PerfEntry[] {
  return entries.slice();
}
