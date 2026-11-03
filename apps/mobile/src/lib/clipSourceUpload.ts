import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { app, auth } from './firebase';
import { classifyClipUploadHttpFailure } from './clipStorageHttpDiagnostics';

export interface ClipSourceProgress {
  transferredBytes: number; totalBytes: number; progress: number; state: 'running' | 'paused';
}
export interface ClipSourceUpload {
  done: Promise<void>; pause(): void; resume(): void; cancel(): void;
}
interface Input {
  uid: string; localUri: string; storagePath: string; contentType: string; maxUploadBytes: number;
  onProgress?: (progress: ClipSourceProgress) => void;
}
class UploadError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}
type Reply = { status: number; headers: Record<string, string>; body?: string };
type HttpOperation = 'start' | 'chunk' | 'finalize' | 'query';
const MAX_DIAGNOSTIC_BODY_BYTES = 16 * 1024;
const CHUNK_BYTES = 1024 * 1024; // A multiple of Firebase's 256 KiB upload granularity.
const MAX_RETRIES = 4;
const INTERRUPTED = Symbol('clip-source-interrupted');
function failure(code: string, retryable = false): UploadError {
  // Never include session URLs, bearer tokens, response bodies, or local paths.
  return new UploadError(code, retryable);
}
function header(reply: Reply, name: string): string | undefined {
  return Object.entries(reply.headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}
function requireSuccess(reply: Reply, operation: HttpOperation): void {
  if (reply.status >= 200 && reply.status < 300) return;
  let error: UploadError;
  if (reply.status === 401) error = failure('storage/unauthenticated');
  else if (reply.status === 403) error = failure('storage/unauthorized');
  else if (reply.status === 404 || reply.status === 410) error = failure('storage/object-not-found');
  else if ([408, 409, 429].includes(reply.status) || reply.status >= 500) error = failure('storage/retry-limit-exceeded', true);
  else error = failure('storage/invalid-argument');
  // Diagnostics must never change authorization, retry decisions, or failures.
  // The classifier returns fixed categories, never server-provided text.
  try {
    const responseCategory = classifyClipUploadHttpFailure(reply.body, header(reply, 'Content-Type'));
    console.warn(`[clips-upload-http] operation=${operation} httpStatus=${reply.status} code=${error.code} responseCategory=${responseCategory}`);
  } catch { /* Keep the original HTTP failure even if diagnostics fail. */ }
  throw error;
}

/** Firebase's resumable wire protocol, using native file uploads instead of the
 * unsupported React Native Blob upload path in the Firebase JS SDK. Protocol:
 * https://github.com/firebase/firebase-js-sdk/blob/firebase%4010.14.1/packages/storage/src/implementation/requests.ts
 * Only a 1 MiB range enters JS at a time. The complete video stays on disk.
 * A paused/interrupted native request is followed by a query of the server's
 * acknowledged offset, so resuming never assumes in-flight bytes were received.
 * Session URLs stay in memory; a killed process retries the durable draft.
 */
export function startClipSourceUpload(input: Input): ClipSourceUpload {
  let paused = false, cancelled = false, total = 0, offset = 0, transferred = 0;
  let interrupt: (() => void) | undefined, wake: (() => void) | undefined;
  let session: string | undefined, chunkDirectory: string | undefined;
  let chunkAttempt = 0;
  let queryRequired = false, retries = 0, refreshedAuth = false, forceRefresh = false;
  const check = () => {
    if (cancelled) throw failure('clip-upload-cancelled');
    if (auth.currentUser?.uid !== input.uid) throw failure('clip-session-changed');
  };
  const emit = () => input.onProgress?.({ transferredBytes: transferred, totalBytes: total,
    progress: total ? transferred / total : 0, state: paused ? 'paused' : 'running' });
  const ready = async () => {
    check();
    while (paused) { await new Promise<void>(resolve => { wake = resolve; }); wake = undefined; check(); }
  };
  const token = async () => {
    await ready();
    try {
      const value = await cancellable(() => auth.currentUser!.getIdToken(forceRefresh), () => {}, 30_000);
      check(); forceRefresh = false; return value;
    } catch (error) {
      check();
      if (error === INTERRUPTED || error instanceof UploadError) throw error;
      if ((error as { code?: string })?.code === 'auth/network-request-failed') throw failure('storage/retry-limit-exceeded', true);
      throw failure('storage/unauthenticated');
    }
  };

  // Race cancellation as well as requesting native cancellation: some Expo
  // versions resolve a cancelled upload without a response, others reject it.
  async function cancellable<T>(run: () => Promise<T>, abort: () => void, timeout: number): Promise<T> {
    check(); if (paused) throw INTERRUPTED;
    let stop!: () => void, timer: ReturnType<typeof setTimeout> | undefined;
    const stopped = new Promise<never>((_resolve, reject) => {
      stop = () => { abort(); reject(INTERRUPTED); };
      timer = setTimeout(() => { abort(); reject(failure('storage/retry-limit-exceeded', true)); }, timeout);
    });
    interrupt = stop;
    try { return await Promise.race([run(), stopped]); }
    finally { if (timer) clearTimeout(timer); if (interrupt === stop) interrupt = undefined; }
  }
  async function control(url: string, command: Exclude<HttpOperation, 'chunk'>, extra: Record<string, string> = {}, body?: string): Promise<Reply> {
    const credential = await token(); await ready();
    const controller = new AbortController();
    let response: Response;
    try {
      response = await cancellable(() => fetch(url, { method: 'POST', signal: controller.signal,
        headers: { Authorization: `Firebase ${credential}`, 'X-Goog-Upload-Command': command, ...extra }, body }),
      () => controller.abort(), 30_000);
    } catch (error) {
      if (error === INTERRUPTED || error instanceof UploadError) throw error;
      throw failure('storage/retry-limit-exceeded', true);
    }
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    const reply: Reply = { status: response.status, headers };
    if (response.status < 200 || response.status >= 300) {
      const declaredLength = header(reply, 'Content-Length');
      const length = declaredLength === undefined ? undefined : Number(declaredLength);
      // React Native fetch has no dependable streaming reader. Skip declared
      // oversized bodies, bound the wait, and let the classifier cap parsing.
      // A failed body read is diagnostic-only; it must not turn a 403 into a
      // retryable timeout or conceal the original HTTP status.
      if (length === undefined || (Number.isFinite(length) && length >= 0 && length <= MAX_DIAGNOSTIC_BODY_BYTES)) {
        try {
          reply.body = await cancellable(() => response.text(), () => controller.abort(), 2_000);
        } catch { /* An unavailable body is itself a fixed diagnostic category. */ }
      }
    }
    requireSuccess(reply, command); check(); return reply;
  }
  async function query(): Promise<boolean> {
    const reply = await control(session!, 'query');
    const status = header(reply, 'X-Goog-Upload-Status');
    const received = header(reply, 'X-Goog-Upload-Size-Received');
    const acknowledged = received == null || received === '' ? NaN : Number(received);
    if (!['active', 'final'].includes(status ?? '') || !Number.isSafeInteger(acknowledged)
        || acknowledged < offset || acknowledged > total || (status === 'final' && acknowledged !== total)) {
      throw failure('storage/invalid-checksum');
    }
    if (acknowledged > offset) retries = 0;
    offset = acknowledged; transferred = offset; queryRequired = false; emit();
    return status === 'final';
  }
  async function uploadChunk(): Promise<boolean> {
    // Never rewrite a file still referenced by a cancelled native HTTP request.
    const length = Math.min(CHUNK_BYTES, total - offset), chunk = `${chunkDirectory}part-${++chunkAttempt}`;
    const chunkOffset = offset;
    if (!length) {
      const reply = await control(session!, 'finalize', { 'X-Goog-Upload-Offset': String(offset) });
      if (header(reply, 'X-Goog-Upload-Status') !== 'final') throw failure('storage/invalid-checksum');
      return true;
    }
    try {
      const bytes = await FileSystem.readAsStringAsync(input.localUri, {
        encoding: FileSystem.EncodingType.Base64, position: offset, length,
      });
      check(); if (paused) throw INTERRUPTED;
      await FileSystem.writeAsStringAsync(chunk, bytes, { encoding: FileSystem.EncodingType.Base64 });
      const info = await FileSystem.getInfoAsync(chunk);
      if (!info.exists || info.isDirectory || info.size !== length) throw failure('clip-file-invalid');
    } catch (error) {
      if (error === INTERRUPTED || error instanceof UploadError) throw error;
      throw failure('clip-file-missing');
    }
    const credential = await token(); await ready();
    const final = offset + length === total;
    let active = true;
    const task = FileSystem.createUploadTask(session!, chunk, {
      httpMethod: 'POST', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: `Firebase ${credential}`, 'Content-Type': 'application/octet-stream',
        'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload', 'X-Goog-Upload-Offset': String(offset) },
    }, event => {
      if (!active || paused || cancelled || auth.currentUser?.uid !== input.uid) return;
      transferred = chunkOffset + Math.min(length, Math.max(0, event.totalBytesSent)); emit();
    });
    queryRequired = true; // Any lost reply must be reconciled before sending more.
    let result: FileSystem.FileSystemUploadResult | undefined | null;
    let cancellation: Promise<void> | undefined;
    try {
      result = await cancellable(() => task.uploadAsync(), () => {
        active = false;
        cancellation ??= task.cancelAsync().catch(() => {});
      }, 120_000);
    } catch (error) {
      if (error === INTERRUPTED || error instanceof UploadError) throw error;
      throw failure('storage/retry-limit-exceeded', true);
    } finally {
      active = false;
      if (cancellation) await cancellation;
      await FileSystem.deleteAsync(chunk, { idempotent: true }).catch(() => {});
    }
    check();
    if (!result) throw failure('storage/retry-limit-exceeded', true);
    requireSuccess(result, final ? 'finalize' : 'chunk');
    const status = header(result, 'X-Goog-Upload-Status');
    if (status !== 'active' && status !== 'final') throw failure('storage/retry-limit-exceeded', true);
    if (status === 'final' && !final) throw failure('storage/invalid-checksum');
    offset += length; transferred = offset; queryRequired = false; retries = 0; emit();
    return status === 'final';
  }
  const done = (async () => {
    // Yield once so the caller can immediately pause/cancel the returned handle.
    await Promise.resolve();
    try {
      check();
      const bucket = app.options.storageBucket;
      if (!bucket) throw failure('storage/no-default-bucket');
      if (!/^[a-z0-9][a-z0-9._-]+$/.test(bucket) || !input.storagePath.startsWith(`clipUploads/${input.uid}/`)
          || !/^clipUploads\/[^/]+\/[A-Za-z0-9_-]+\/source$/.test(input.storagePath)
          || !Number.isSafeInteger(input.maxUploadBytes) || input.maxUploadBytes <= 0
          || !['video/mp4', 'video/quicktime', 'video/webm'].includes(input.contentType)) throw failure('storage/invalid-argument');
      let info: FileSystem.FileInfo;
      try { info = await FileSystem.getInfoAsync(input.localUri); }
      catch { throw failure('clip-file-missing'); }
      if (!info.exists || info.isDirectory || !Number.isSafeInteger(info.size) || info.size <= 0) throw failure('clip-file-missing');
      total = info.size;
      if (total > input.maxUploadBytes) throw failure('clip-file-too-large');
      if (!FileSystem.cacheDirectory) throw failure('clip-file-invalid');
      chunkDirectory = `${FileSystem.cacheDirectory}clip-upload-${Crypto.randomUUID()}/`;
      await FileSystem.makeDirectoryAsync(chunkDirectory, { intermediates: true });
      const endpoint = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o`;
      emit();
      while (true) {
        await ready();
        try {
          if (!session) {
            const reply = await control(`${endpoint}?name=${encodeURIComponent(input.storagePath)}`, 'start', {
              'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Header-Content-Length': String(total),
              'X-Goog-Upload-Header-Content-Type': input.contentType, 'Content-Type': 'application/json; charset=utf-8',
            }, JSON.stringify({ name: input.storagePath, contentType: input.contentType }));
            const location = header(reply, 'X-Goog-Upload-URL');
            // RN 0.79's URL.hostname/protocol/pathname accessors throw. Pin the
            // full HTTPS endpoint as a string, accepting only a URI query suffix.
            // This rejects other hosts, credentials, fragments, path changes,
            // backslashes, whitespace, and control characters without a polyfill.
            const valid = location?.startsWith(`${endpoint}?`) === true
              && /^[A-Za-z0-9._~!$&'()*+,;=:@/?%+-]+$/.test(location.slice(endpoint.length + 1));
            if (!valid || header(reply, 'X-Goog-Upload-Status') !== 'active') throw failure('storage/invalid-argument');
            session = location;
          }
          check(); if (paused) continue;
          if (queryRequired && await query()) return;
          check(); if (paused) continue;
          if (await uploadChunk()) return;
        } catch (error) {
          check();
          if (error === INTERRUPTED) continue;
          const reason = error as UploadError;
          if (reason.code === 'storage/unauthenticated' && !refreshedAuth) {
            refreshedAuth = true; forceRefresh = true; continue;
          }
          if (!reason.retryable) throw error;
          if (++retries > MAX_RETRIES) throw failure('storage/retry-limit-exceeded');
          // Backoff is interruptible; manual pause/cancel never waits for a timer.
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            await cancellable(() => new Promise<void>(resolve => { timer = setTimeout(resolve, 500 * 2 ** (retries - 1)); }),
              () => { if (timer) clearTimeout(timer); }, 10_000);
          } catch (interruption) { if (interruption !== INTERRUPTED) throw interruption; }
          finally { if (timer) clearTimeout(timer); }
        }
      }
    } catch (error) {
      if (error instanceof UploadError) throw error;
      throw failure('storage/unknown');
    } finally {
      interrupt = undefined; wake?.(); wake = undefined;
      if (chunkDirectory) await FileSystem.deleteAsync(chunkDirectory, { idempotent: true }).catch(() => {});
    }
  })();
  return { done,
    pause() { paused = true; interrupt?.(); emit(); },
    resume() { paused = false; wake?.(); emit(); },
    cancel() { cancelled = true; interrupt?.(); wake?.(); },
  };
}
