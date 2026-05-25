// Durable outgoing-message queue (offline-first).
//
// Messages composed while offline are persisted here and delivered FIFO when
// connectivity returns. Backed by AsyncStorage so the queue survives app
// background/restart. An in-memory cache + listener set keeps the UI reactive
// without re-reading storage on every render.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type QueueStatus = 'queued' | 'syncing' | 'failed';

export type QueuedMessage = {
  localQueueId:     string;
  clientMessageId:  string;
  conversationId:   string;
  conversationType: 'direct' | 'group';
  text:             string;
  replyTo:          any | null;
  createdAt:        number;
  updatedAt:        number;
  status:           QueueStatus;
  retryCount:       number;
  lastError?:       string | null;
};

const KEY = 'offlineQueue.v1';

let cache: QueuedMessage[] | null = null;
type Listener = (q: QueuedMessage[]) => void;
const listeners = new Set<Listener>();

async function load(): Promise<QueuedMessage[]> {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function emit() {
  const q = cache ?? [];
  listeners.forEach(l => { try { l(q); } catch {} });
}

async function persist() {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(cache ?? [])); } catch {}
  emit();
}

/** Subscribe to the full queue. Fires immediately with the current snapshot. */
export function subscribeQueue(cb: Listener): () => void {
  listeners.add(cb);
  load().then(q => cb([...q]));
  return () => { listeners.delete(cb); };
}

export async function getQueue(): Promise<QueuedMessage[]> {
  return [...(await load())];
}

export async function enqueue(
  item: Pick<QueuedMessage, 'clientMessageId' | 'conversationId' | 'conversationType' | 'text' | 'replyTo'>,
): Promise<QueuedMessage> {
  const q = await load();
  const now = Date.now();
  const msg: QueuedMessage = {
    ...item,
    localQueueId: `q_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt:    now,
    updatedAt:    now,
    status:       'queued',
    retryCount:   0,
    lastError:    null,
  };
  cache = [...q, msg];
  await persist();
  return msg;
}

export async function updateQueued(localQueueId: string, patch: Partial<QueuedMessage>): Promise<void> {
  const q = await load();
  cache = q.map(m => (m.localQueueId === localQueueId ? { ...m, ...patch, updatedAt: Date.now() } : m));
  await persist();
}

export async function removeQueued(localQueueId: string): Promise<void> {
  const q = await load();
  cache = q.filter(m => m.localQueueId !== localQueueId);
  await persist();
}
