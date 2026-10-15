/** Keep maintenance off the first local read, and stop late opens on navigation. */
export interface ConversationOpenSteps {
  openDb: () => Promise<void>;
  readClearedAt: () => Promise<number>;
  showLocal: (clearedAt: number) => Promise<void>;
  startLive: () => () => void;
  maintain: () => Promise<void>;
  onReadError: () => void;
}

export function openConversation(steps: ConversationOpenSteps): () => void {
  let cancelled = false;
  let stopLive: (() => void) | undefined;
  void (async () => {
    try {
      await steps.openDb();
      if (cancelled) return;
      // Never briefly resurrect a cleared chat, even on the first local read.
      const clearedAt = await steps.readClearedAt();
      if (cancelled) return;
      // Queue the local read first, then start network work while it completes.
      // The saved rows never wait for the network, and the network no longer
      // waits for the SQLite/UI read to finish before starting its handshake.
      const localRead = steps.showLocal(clearedAt);
      // Observe both promises even if starting a listener throws synchronously.
      await Promise.all([localRead, Promise.resolve().then(() => {
        if (!cancelled) stopLive = steps.startLive();
      })]);
      if (cancelled) return;
    } catch {
      stopLive?.();
      stopLive = undefined;
      if (!cancelled) steps.onReadError();
      return;
    }
    // The live listener and notification target do not wait for migration or
    // outbox housekeeping. A maintenance failure must not discard local data.
    try { await steps.maintain(); } catch { /* retry on a subsequent open */ }
  })();
  return () => {
    cancelled = true;
    stopLive?.();
    stopLive = undefined;
  };
}
