// A single-flight runner that never DROPS a request.
//
// The previous refresh guard (`if (refreshing) return;`) silently discarded a
// refresh requested while another was running — exactly what happens when a new
// message lands mid-refresh — so the message stayed invisible until some later,
// unrelated change. Here a request made during a run marks the runner dirty and
// the run repeats once more after it finishes; any number of requests during one
// run collapse into a single extra pass. The returned promise settles only after
// a pass that STARTED after the request, so `await run()` means "the data I
// asked for is now reflected".

export type CoalescedRunner = () => Promise<void>;

export function coalescing(task: () => Promise<void>): CoalescedRunner {
  let current: Promise<void> | null = null;
  let dirty = false;
  return () => {
    if (current) { dirty = true; return current; }
    current = (async () => {
      try {
        do {
          dirty = false;
          try { await task(); } catch { /* the task reports its own errors */ }
        } while (dirty);
      } finally {
        current = null;
      }
    })();
    return current;
  };
}
