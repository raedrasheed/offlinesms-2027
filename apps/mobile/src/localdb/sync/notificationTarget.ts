// Notification → message: make the exact message a push names available
// locally as fast as possible, independently of every other sync activity.
//
// Sequence (see docs/PERFORMANCE_AND_SYNC.md):
//   push arrives / is tapped → request(conversationId, messageId)
//     • local DB not open yet (cold start) → remembered, run when it opens
//     • already stored locally            → 'local'
//     • offline                           → 'waiting-network', retried on reconnect
//     • otherwise ONE document read of that message (not a page pull, not the
//       history backfill, not the listener's first snapshot) → 'ready'
//   Listeners (the open conversation) are told when the state changes.
// Idempotent and duplicate-free: the fetched message is upserted by its remote
// id, the same key the realtime feeder and the pulls use.

export type TargetState = 'pending' | 'fetching' | 'waiting-network' | 'ready' | 'missing' | 'error';

export interface TargetDeps {
  isDbOpen(): boolean;
  isOnline(): boolean;
  hasLocal(messageId: string): Promise<boolean>;
  fetchOne(conversationId: string, messageId: string): Promise<boolean>;
  loadPending?(): Promise<Array<{ conversationId: string; messageId: string }>>;
  savePending?(targets: Array<{ conversationId: string; messageId: string }>): Promise<void>;
  onConnectivity(cb: (online: boolean) => void): () => void;
}

type Listener = (conversationId: string, messageId: string, state: TargetState) => void;

export function createNotificationTargets(deps: TargetDeps) {
  const states = new Map<string, TargetState>();
  const inflight = new Map<string, Promise<TargetState>>();
  const queued = new Map<string, { conversationId: string; messageId: string }>();
  const listeners = new Set<Listener>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const attempts = new Map<string, number>();
  const localReady = new Map<string, (state: TargetState) => void>();
  const localChecks = new Map<string, Promise<void>>();
  let generation = 0;
  let persistence = Promise.resolve();
  const persist = () => {
    if (!deps.isDbOpen() || !deps.savePending) return;
    const targets = [...queued.values()];
    const epoch = generation;
    persistence = persistence.then(async () => {
      if (epoch === generation && deps.isDbOpen()) await deps.savePending!(targets);
    }).catch(() => {});
  };
  let stopConn: (() => void) | null = null;

  const key = (c: string, m: string) => `${c}/${m}`;
  function set(c: string, m: string, s: TargetState) {
    const k = key(c, m);
    states.set(k, s);
    if (s === 'ready' || s === 'missing') {
      clearTimeout(timers.get(k)); timers.delete(k); attempts.delete(k);
    }
    persist();
    for (const l of listeners) { try { l(c, m, s); } catch { /* noop */ } }
  }
  function ready(c: string, m: string) {
    const k = key(c, m);
    const complete = localReady.get(k);
    inflight.delete(k);
    localReady.delete(k);
    queued.delete(k);
    set(c, m, 'ready');
    complete?.('ready');
  }
  function watchConnectivity() {
    if (stopConn) return;
    stopConn = deps.onConnectivity(online => {
      if (!online) return;
      const retry = [...queued.values()].filter(t => ['waiting-network', 'error', 'pending'].includes(states.get(key(t.conversationId, t.messageId)) ?? ''));
      for (const t of retry) void run(t.conversationId, t.messageId);
    });
  }

  async function attempt(c: string, m: string, ownsFlight: () => boolean): Promise<TargetState> {
    const epoch = generation;
    const current = () => epoch === generation && ownsFlight();
    queued.set(key(c, m), { conversationId: c, messageId: m });
    if (!deps.isDbOpen()) { queued.set(key(c, m), { conversationId: c, messageId: m }); set(c, m, 'pending'); return 'pending'; }
    try {
      const local = await deps.hasLocal(m);
      if (!current()) return 'pending';
      if (local) { ready(c, m); return 'ready'; }
    } catch { /* fall through to fetch */ }
    if (!current()) return 'pending';
    if (!deps.isOnline()) {
      queued.set(key(c, m), { conversationId: c, messageId: m });
      watchConnectivity();
      set(c, m, 'waiting-network');
      return 'waiting-network';
    }
    set(c, m, 'fetching');
    try {
      const ok = await deps.fetchOne(c, m);
      if (!current()) return 'pending';
      // The live feed or catch-up may have committed this message while the
      // direct read was in flight. A late result must not undo that success.
      if (states.get(key(c, m)) === 'ready') return 'ready';
      queued.delete(key(c, m));
      const s: TargetState = ok ? 'ready' : 'missing';
      set(c, m, s);
      return s;
    } catch (err: any) {
      if (!current()) return 'pending';
      if (states.get(key(c, m)) === 'ready') return 'ready';
      try {
        if (await deps.hasLocal(m)) {
          if (!current()) return 'pending';
          ready(c, m); return 'ready';
        }
      } catch { /* preserve the original fetch error */ }
      if (!current()) return 'pending';
      const code = String(err?.code ?? '').replace(/^(firestore|functions)\//, '');
      if (['permission-denied', 'invalid-argument', 'not-found'].includes(code)) {
        queued.delete(key(c, m)); set(c, m, 'error'); return 'error';
      }
      // Network flapped mid-read: keep it queued for the reconnect retry.
      queued.set(key(c, m), { conversationId: c, messageId: m });
      watchConnectivity();
      const s: TargetState = deps.isOnline() ? 'error' : 'waiting-network';
      set(c, m, s);
      const k = key(c, m);
      const n = (attempts.get(k) ?? 0) + 1;
      attempts.set(k, n);
      if (deps.isOnline() && n <= 4 && !timers.has(k)) {
        const delay = Math.min(30_000, 1_000 * 2 ** (n - 1)) * (0.75 + Math.random() * 0.5);
        timers.set(k, setTimeout(() => { timers.delete(k); void run(c, m); }, delay));
      }
      return s;
    }
  }

  function run(c: string, m: string): Promise<TargetState> {
    const k = key(c, m);
    const existing = inflight.get(k);
    if (existing) return existing;
    clearTimeout(timers.get(k)); timers.delete(k);
    const available = new Promise<TargetState>(resolve => {
      localReady.set(k, resolve);
    });
    const p: Promise<TargetState> = Promise.race([attempt(c, m, () => inflight.get(k) === p), available]).finally(() => {
      if (inflight.get(k) === p) { inflight.delete(k); localReady.delete(k); }
    });
    inflight.set(k, p);
    return p;
  }

  return {
    /** Request the message a notification points at. Safe to call repeatedly. */
    request(conversationId: string, messageId: string): Promise<TargetState> {
      return run(conversationId, messageId);
    },
    /** The local DB just opened: run everything requested before it was ready. */
    onDbOpened(): void {
      const epoch = generation;
      void deps.loadPending?.().then(targets => {
        if (epoch !== generation) return;
        for (const t of targets) void run(t.conversationId, t.messageId);
      }).catch(() => {});
      for (const t of [...queued.values()]) {
        if (states.get(key(t.conversationId, t.messageId)) === 'pending') void run(t.conversationId, t.messageId);
      }
    },
    /** Retry a target that failed (e.g. the user pressed "retry"). */
    retry(conversationId: string, messageId: string): Promise<TargetState> {
      attempts.delete(key(conversationId, messageId));
      return run(conversationId, messageId);
    },
    state(conversationId: string, messageId: string): TargetState | undefined {
      return states.get(key(conversationId, messageId));
    },
    /** A committed local write wins immediately over a slow direct network read. */
    onLocalMessagesChanged(conversationId: string): Promise<void> {
      const epoch = generation;
      const checks = [...queued.values()].filter(t => t.conversationId === conversationId).map(t => {
        const k = key(t.conversationId, t.messageId);
        const existing = localChecks.get(k);
        if (existing) return existing;
        const check = (async () => {
          const local = await deps.hasLocal(t.messageId);
          if (local && epoch === generation) ready(t.conversationId, t.messageId);
        })().catch(() => {}).finally(() => { if (localChecks.get(k) === check) localChecks.delete(k); });
        localChecks.set(k, check);
        return check;
      });
      return Promise.all(checks).then(() => {});
    },
    subscribe(l: Listener): () => void { listeners.add(l); return () => { listeners.delete(l); }; },
    /** Test/teardown helper. */
    reset(): void {
      generation++;
      for (const resolve of localReady.values()) resolve('pending');
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear(); attempts.clear(); states.clear(); inflight.clear(); queued.clear();
      localReady.clear(); localChecks.clear();
      stopConn?.(); stopConn = null;
    },
  };
}

export type NotificationTargets = ReturnType<typeof createNotificationTargets>;
