import { getFunctions, httpsCallable } from 'firebase/functions';
import { app, auth } from './firebase';

export type ChatVideoThumbnail = { state: 'ready' | 'pending' | 'failed'; thumbnailPath?: string; thumbnailURL?: string };
type Request = { uid: string; conversationId: string; messageId: string; source: string };
type Job = { input: Request; key: string; allowed: Set<() => boolean>; promise: Promise<ChatVideoThumbnail | null>; resolve: (result: ChatVideoThumbnail | null) => void };
const cache = new Map<string, { until: number; result: ChatVideoThumbnail | null }>();
const jobs = new Map<string, Job>(), queue: Job[] = [];
let active = 0, cacheUid = '';

export function chatVideoThumbnailKey(input: Request): string {
  return JSON.stringify([input.uid, input.conversationId, input.messageId, input.source]);
}
function remember(key: string, result: ChatVideoThumbnail | null, ttl: number) {
  cache.delete(key); cache.set(key, { until: Date.now() + ttl, result });
  while (cache.size > 256) cache.delete(cache.keys().next().value!);
}
function drain() {
  while (active < 2 && queue.length) {
    const job = queue.shift()!;
    if (auth.currentUser?.uid !== job.input.uid || ![...job.allowed].some(allowed => allowed())) {
      jobs.delete(job.key); job.resolve(null); continue;
    }
    active++;
    void httpsCallable<{ conversationId: string; messageId: string }, ChatVideoThumbnail>(getFunctions(app), 'ensureChatVideoThumbnail')({
      conversationId: job.input.conversationId, messageId: job.input.messageId,
    }).then(({ data }) => {
      if (auth.currentUser?.uid !== job.input.uid) { job.resolve(null); return; }
      const result = data && ['ready', 'pending', 'failed'].includes(data.state) ? data : null;
      remember(job.key, result, result?.state === 'pending' ? 60_000 : result ? 300_000 : 30_000);
      job.resolve(result);
    }).catch(() => {
      if (auth.currentUser?.uid === job.input.uid) remember(job.key, null, 30_000);
      job.resolve(null);
    }).finally(() => { jobs.delete(job.key); active--; drain(); });
  }
}

/** Metadata-only request. Coalesce mounted cells, bound concurrency and retry
 * only after a later visibility/connectivity entry; never poll the callable. */
export function ensureChatVideoThumbnail(input: Request, allowed: () => boolean): Promise<ChatVideoThumbnail | null> {
  if (!input.uid || auth.currentUser?.uid !== input.uid || !allowed()) return Promise.resolve(null);
  if (cacheUid !== input.uid) { cacheUid = input.uid; cache.clear(); }
  const key = chatVideoThumbnailKey(input), cached = cache.get(key);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.result);
  const pending = jobs.get(key);
  if (pending) { pending.allowed.add(allowed); return pending.promise; }
  if (queue.length >= 32) return Promise.resolve(null);
  let resolve!: Job['resolve'];
  const promise = new Promise<ChatVideoThumbnail | null>(done => { resolve = done; });
  const job: Job = { input, key, allowed: new Set([allowed]), promise, resolve };
  jobs.set(key, job); queue.push(job); drain();
  return promise;
}
