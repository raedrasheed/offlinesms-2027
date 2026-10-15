// Bounded foreground preloading. It never marks messages as read, navigates,
// or delays opening a chat. SQLite remains the only message source of truth.
export interface PreloadChat {
  id: string;
  last_message_id: string | null;
  last_message_at: number | null;
  unread_count: number;
  archived: number;
  status: string;
}
export interface MessagePreloadDeps {
  canRun: () => boolean;
  fetchRecent: (id: string) => Promise<unknown>;
  listen: (id: string, onServer: () => void, onError: () => void) => () => void;
}
export const PRELOAD_CHATS = 8;
export const PRELOAD_LIVE_CHATS = 3;
export const PRELOAD_CONCURRENCY = 2;
const MAX_TRACKED = 50;
const signature = (c: PreloadChat) => `${c.last_message_id ?? ''}:${c.last_message_at ?? 0}`;

export function createMessagePreload(deps: MessagePreloadDeps) {
  let stopped = false;
  let chats: PreloadChat[] = [];
  let seen = new Map<string, string>();
  const done = new Map<string, string>();
  const pending = new Map<string, string>();
  const flights = new Map<string, string>();
  const live = new Map<string, { stop: () => void; ready: boolean }>();
  const failures = new Map<string, number>();
  let retry: ReturnType<typeof setTimeout> | undefined;

  const active = () => !stopped && deps.canRun();
  function pause() {
    for (const entry of live.values()) entry.stop();
    live.clear();
    if (retry) clearTimeout(retry);
    retry = undefined;
  }
  function drain() {
    if (!active()) return;
    for (const [id, sig] of pending) {
      if (flights.size >= PRELOAD_CONCURRENCY) break;
      if (flights.has(id)) continue;
      pending.delete(id);
      flights.set(id, sig);
      void Promise.resolve().then(() => {
        if (active()) return deps.fetchRecent(id);
        throw new Error('preload-paused');
      }).then(() => {
        if (stopped || !seen.has(id)) return;
        done.set(id, sig);
        failures.delete(id);
      }).catch(() => {
        if (stopped || !seen.has(id)) return;
        const attempts = (failures.get(id) ?? 0) + 1;
        failures.set(id, attempts);
        // Retry boundedly; reconnect/foreground resets this budget.
        if (attempts <= 2 && !retry && active()) retry = setTimeout(() => {
          retry = undefined; reconcile();
        }, 1500 * attempts);
      }).finally(() => { flights.delete(id); drain(); });
    }
  }
  function reconcile() {
    if (!active()) { pause(); return; }
    const watched = new Set(chats.slice(0, PRELOAD_LIVE_CHATS).map(c => c.id));
    for (const [id, entry] of live) if (!watched.has(id)) { entry.stop(); live.delete(id); }
    for (const id of watched) if (!live.has(id)) {
      const entry = { stop: () => {}, ready: false };
      live.set(id, entry);
      entry.stop = deps.listen(id, () => {
        if (!active() || live.get(id) !== entry) return;
        entry.ready = true;
        pending.delete(id);
      }, () => { if (live.get(id) === entry) entry.ready = false; });
    }
    chats.forEach((c, i) => {
      const sig = signature(c);
      const changed = seen.has(c.id) && seen.get(c.id) !== sig;
      if (changed) failures.delete(c.id);
      if ((i < PRELOAD_CHATS || changed || failures.has(c.id)) && done.get(c.id) !== sig
          && flights.get(c.id) !== sig && !live.get(c.id)?.ready && (failures.get(c.id) ?? 0) <= 2) {
        pending.set(c.id, sig);
      }
    });
    seen = new Map(chats.map(c => [c.id, signature(c)]));
    const present = new Set(seen.keys());
    for (const map of [pending, done, failures]) for (const id of map.keys()) if (!present.has(id)) map.delete(id);
    drain();
  }
  return {
    update(rows: readonly PreloadChat[]) {
      if (stopped) return;
      chats = rows.filter(c => !c.archived && c.status !== 'disabled')
        .sort((a, b) => Number(b.unread_count > 0) - Number(a.unread_count > 0)
          || (b.last_message_at ?? 0) - (a.last_message_at ?? 0)).slice(0, MAX_TRACKED);
      reconcile();
    },
    resume() { if (stopped) return; pause(); done.clear(); failures.clear(); reconcile(); },
    pause,
    stop() { stopped = true; pause(); pending.clear(); done.clear(); seen.clear(); failures.clear(); },
  };
}
