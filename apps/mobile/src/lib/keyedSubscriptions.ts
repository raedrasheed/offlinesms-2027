// A set of live subscriptions keyed by string, updated by DIFF: `sync(keys)`
// starts only the new keys and stops only the ones that went away.
//
// The chat list used to tear down and recreate every per-chat presence/typing
// listener whenever its key string changed — and that string included the list
// ORDER, so each incoming message (which moves a chat to the top) recreated
// ~2 Firestore listeners + 1 timer for every visible chat.

export interface KeyedSubscriptions {
  sync(keys: Iterable<string>): void;
  clear(): void;
  size(): number;
}

export function createKeyedSubscriptions(start: (key: string) => () => void): KeyedSubscriptions {
  const active = new Map<string, () => void>();
  const stop = (k: string) => {
    const u = active.get(k);
    active.delete(k);
    try { u?.(); } catch { /* noop */ }
  };
  return {
    sync(keys) {
      const next = new Set(keys);
      for (const k of [...active.keys()]) if (!next.has(k)) stop(k);
      for (const k of next) if (!active.has(k)) active.set(k, start(k));
    },
    clear() { for (const k of [...active.keys()]) stop(k); },
    size() { return active.size; },
  };
}
