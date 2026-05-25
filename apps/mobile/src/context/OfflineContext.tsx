// OfflineContext — the single source of truth for connectivity + the
// outgoing-message queue + reconnect sync.
//
// - Tracks online/offline via @react-native-community/netinfo (one listener).
// - Mirrors the durable queue (offlineQueue) into React state for reactive UI.
// - When connectivity returns and the queue is non-empty, drains it FIFO,
//   sending each message through the existing sendTextMessage callable.
// - Guards against parallel sync loops and duplicate sends (a message is
//   removed from the queue only after the server confirms success).

import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import NetInfo from '@react-native-community/netinfo';
import { sendTextMessage } from '../lib/conversations';
import {
  QueuedMessage, subscribeQueue, enqueue as enqueueRaw, updateQueued, removeQueued, getQueue,
} from '../lib/offlineQueue';

const MAX_RETRIES = 5;

type EnqueueArgs = {
  conversationId:   string;
  conversationType: 'direct' | 'group';
  text:             string;
  replyTo?:         any | null;
};

type OfflineValue = {
  isOnline:      boolean;
  isOffline:     boolean;
  isSyncing:     boolean;
  queuedCount:   number;
  lastSyncError: string | null;
  queue:         QueuedMessage[];
  queuedFor:     (conversationId: string) => QueuedMessage[];
  deliveredFor:  (conversationId: string) => number;  // delivered in the last sync run
  deliveredNonce: number;                              // bumps when a sync run delivers messages
  enqueue:       (args: EnqueueArgs) => Promise<void>;
};

const Ctx = createContext<OfflineValue>({
  isOnline: true, isOffline: false, isSyncing: false, queuedCount: 0,
  lastSyncError: null, queue: [], queuedFor: () => [], deliveredFor: () => 0,
  deliveredNonce: 0, enqueue: async () => {},
});

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline]   = useState(true);
  const [queue, setQueue]         = useState<QueuedMessage[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<{ map: Record<string, number>; nonce: number }>({ map: {}, nonce: 0 });

  const syncingRef = useRef(false);
  const onlineRef  = useRef(true);

  // One NetInfo listener for the whole app.
  useEffect(() => {
    const unsub = NetInfo.addEventListener(state => {
      const usable = state.isConnected === true && state.isInternetReachable !== false;
      onlineRef.current = usable;
      setIsOnline(usable);
    });
    NetInfo.fetch().then(state => {
      const usable = state.isConnected === true && state.isInternetReachable !== false;
      onlineRef.current = usable;
      setIsOnline(usable);
    });
    return () => unsub();
  }, []);

  // Mirror the durable queue into React state.
  useEffect(() => subscribeQueue(setQueue), []);

  const runSync = useCallback(async () => {
    if (syncingRef.current) return;          // guard parallel loops
    if (!onlineRef.current) return;
    const pending = (await getQueue()).filter(m => m.status !== 'failed');
    if (pending.length === 0) return;

    syncingRef.current = true;
    setIsSyncing(true);
    setLastSyncError(null);
    const deliveredThisRun: Record<string, number> = {};

    try {
      // FIFO by creation time.
      const ordered = [...pending].sort((a, b) => a.createdAt - b.createdAt);
      for (const m of ordered) {
        if (!onlineRef.current) break;       // lost connection mid-drain → resume later
        await updateQueued(m.localQueueId, { status: 'syncing' });
        try {
          await sendTextMessage(m.conversationId, m.text, m.replyTo ?? null);
          await removeQueued(m.localQueueId);   // only after server confirms
          deliveredThisRun[m.conversationId] = (deliveredThisRun[m.conversationId] ?? 0) + 1;
        } catch (e: any) {
          const retryCount = (m.retryCount ?? 0) + 1;
          const permanent = retryCount >= MAX_RETRIES;
          await updateQueued(m.localQueueId, {
            status:    permanent ? 'failed' : 'queued',
            retryCount,
            lastError: e?.message ?? 'send-failed',
          });
          setLastSyncError(e?.message ?? 'send-failed');
          if (!permanent) break;             // pause; retry on next reconnect/tick
        }
      }
    } finally {
      const total = Object.values(deliveredThisRun).reduce((a, b) => a + b, 0);
      if (total > 0) {
        setDelivered(prev => ({ map: deliveredThisRun, nonce: prev.nonce + 1 }));
      }
      syncingRef.current = false;
      setIsSyncing(false);
    }
  }, []);

  // Kick a sync whenever we are online and have pending work.
  useEffect(() => {
    const hasPending = queue.some(m => m.status !== 'failed');
    if (isOnline && hasPending) runSync();
  }, [isOnline, queue, runSync]);

  const enqueue = useCallback(async (args: EnqueueArgs) => {
    await enqueueRaw({
      conversationId:   args.conversationId,
      conversationType: args.conversationType,
      text:             args.text,
      replyTo:          args.replyTo ?? null,
      clientMessageId:  `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    });
  }, []);

  const queuedCount = useMemo(() => queue.filter(m => m.status !== 'failed').length, [queue]);

  const value = useMemo<OfflineValue>(() => ({
    isOnline,
    isOffline: !isOnline,
    isSyncing,
    queuedCount,
    lastSyncError,
    queue,
    queuedFor: (cid: string) => queue.filter(m => m.conversationId === cid),
    deliveredFor: (cid: string) => delivered.map[cid] ?? 0,
    deliveredNonce: delivered.nonce,
    enqueue,
  }), [isOnline, isSyncing, queuedCount, lastSyncError, queue, delivered, enqueue]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOffline(): OfflineValue {
  return useContext(Ctx);
}
