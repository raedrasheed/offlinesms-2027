import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'owner', getIdToken: vi.fn() } as { uid: string; getIdToken: ReturnType<typeof vi.fn> } | null },
  files: new Map<string, number>(), reads: [] as Array<{ path: string; position: number; length: number }>,
  uploaded: [] as Array<{ url: string; path: string; options: any; progress: (value: any) => void; task: any }>,
  upload: vi.fn(), cancel: vi.fn(), remove: vi.fn(), getToken: vi.fn(),
}));
vi.mock('../src/lib/firebase', () => ({ app: { options: { storageBucket: 'test.firebasestorage.app' } }, auth: state.auth }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'upload-test' }));
vi.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' }, FileSystemUploadType: { BINARY_CONTENT: 0 },
  getInfoAsync: async (path: string) => ({ exists: state.files.has(path), isDirectory: false, size: state.files.get(path) ?? 0 }),
  makeDirectoryAsync: vi.fn(),
  readAsStringAsync: async (path: string, options: { position: number; length: number }) => {
    state.reads.push({ path, ...options }); return `bytes:${Math.min(options.length, (state.files.get(path) ?? 0) - options.position)}`;
  },
  writeAsStringAsync: async (path: string, encoded: string) => { state.files.set(path, Number(encoded.replace('bytes:', ''))); },
  deleteAsync: async (path: string) => { state.remove(path); for (const key of state.files.keys()) if (key.startsWith(path)) state.files.delete(key); },
  createUploadTask: (url: string, path: string, options: any, progress: (value: any) => void) => {
    const task = { uploadAsync: () => state.upload({ url, path, options, progress }), cancelAsync: state.cancel };
    state.uploaded.push({ url, path, options, progress, task }); return task;
  },
}));

import { startClipSourceUpload } from '../src/lib/clipSourceUpload';
const MIB = 1024 * 1024;
const session = 'https://firebasestorage.googleapis.com/v0/b/test.firebasestorage.app/o?upload_id=secret';
const source = 'file:///documents/clip.mp4';
const defaults = { uid: 'owner', localUri: source, storagePath: 'clipUploads/owner/clip1/source', contentType: 'video/mp4', maxUploadBytes: 80 * MIB };
function response(status = 200, headers: Record<string, string> = {}, body = '') {
  return { status, headers: new Headers(headers), text: vi.fn(async () => body) };
}
function nativeReply(status = 'final', http = 200) {
  return { status: http, headers: { 'x-goog-upload-status': status }, body: '{"downloadTokens":"never-expose"}' };
}
const begin = () => response(200, { 'X-Goog-Upload-Status': 'active', 'X-Goog-Upload-URL': session });
const query = (size: number, status = 'active') => response(200, { 'X-Goog-Upload-Status': status, 'X-Goog-Upload-Size-Received': String(size) });
const spin = async (until: () => boolean) => { for (let i = 0; i < 100 && !until(); i++) await Promise.resolve(); expect(until()).toBe(true); };

beforeEach(() => {
  vi.clearAllMocks(); state.files.clear(); state.files.set(source, 2 * MIB + 7); state.reads = []; state.uploaded = [];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  state.auth.currentUser = { uid: 'owner', getIdToken: state.getToken }; state.getToken.mockResolvedValue('id-token');
  state.cancel.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async () => begin()));
  state.upload.mockImplementation(async ({ options }) => nativeReply(options.headers['X-Goog-Upload-Command'].includes('finalize') ? 'final' : 'active'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('native resumable clip source transfer', () => {
  it('streams bounded native chunks and finalizes before resolving; keeps source and removes temporary chunks', async () => {
    vi.stubGlobal('URL', class { constructor() { throw new Error('React Native URL getters are not implemented'); } });
    const progress = vi.fn();
    await startClipSourceUpload({ ...defaults, onProgress: progress }).done;
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toContain('?name=clipUploads%2Fowner%2Fclip1%2Fsource');
    expect(init?.headers).toMatchObject({ Authorization: 'Firebase id-token', 'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(2 * MIB + 7),
      'X-Goog-Upload-Header-Content-Type': 'video/mp4' });
    expect(JSON.parse(init!.body as string)).toEqual({ name: defaults.storagePath, contentType: 'video/mp4' });
    expect(state.reads.map(row => [row.position, row.length])).toEqual([[0, MIB], [MIB, MIB], [2 * MIB, 7]]);
    expect(state.uploaded.map(row => row.options.headers['X-Goog-Upload-Command'])).toEqual(['upload', 'upload', 'upload, finalize']);
    expect(state.uploaded.map(row => row.options.headers['X-Goog-Upload-Offset'])).toEqual(['0', String(MIB), String(2 * MIB)]);
    expect(state.uploaded.every(row => row.options.uploadType === 0 && row.url === session)).toBe(true);
    expect(state.files.has(source)).toBe(true); expect([...state.files.keys()].some(path => path.startsWith('file:///cache/'))).toBe(false);
    expect(progress).toHaveBeenLastCalledWith({ transferredBytes: 2 * MIB + 7, totalBytes: 2 * MIB + 7, progress: 1, state: 'running' });
  });

  it('pauses a native request and resumes from the server offset rather than resending acknowledged bytes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(query(MIB) as any);
    state.upload.mockImplementationOnce(() => new Promise(() => {}));
    const handle = startClipSourceUpload(defaults);
    await spin(() => state.uploaded.length === 1); handle.pause();
    await spin(() => state.cancel.mock.calls.length === 1);
    expect(state.uploaded).toHaveLength(1);
    handle.resume(); await handle.done;
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({ 'X-Goog-Upload-Command': 'query' });
    expect(state.reads.map(row => row.position)).toEqual([0, MIB, 2 * MIB]);
    expect(state.uploaded[1].options.headers['X-Goog-Upload-Offset']).toBe(String(MIB));
  });

  it('accepts a lost final response only after querying a complete acknowledged object', async () => {
    vi.useFakeTimers(); state.files.set(source, 20);
    vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(query(20, 'final') as any);
    state.upload.mockRejectedValueOnce(new Error('connection dropped'));
    const handle = startClipSourceUpload(defaults);
    await vi.runAllTimersAsync(); await handle.done;
    expect(state.uploaded).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resumes a partially acknowledged chunk at the exact server offset after a transient error', async () => {
    vi.useFakeTimers(); state.files.set(source, MIB + 100);
    vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(query(256 * 1024) as any);
    state.upload.mockResolvedValueOnce(nativeReply('active', 503));
    const handle = startClipSourceUpload(defaults);
    await vi.runAllTimersAsync(); await handle.done;
    expect(state.reads.map(row => [row.position, row.length])).toEqual([[0, MIB], [256 * 1024, 768 * 1024 + 100]]);
    expect(state.uploaded[1].options.headers['X-Goog-Upload-Offset']).toBe(String(256 * 1024));
  });

  it('cancels while paused without another request or deleting the source draft', async () => {
    const handle = startClipSourceUpload(defaults); handle.pause();
    const rejected = expect(handle.done).rejects.toMatchObject({ code: 'clip-upload-cancelled' });
    handle.cancel(); await rejected;
    expect(fetch).not.toHaveBeenCalled(); expect(state.uploaded).toHaveLength(0); expect(state.files.has(source)).toBe(true);
  });

  it('cancels immediately even when the native cancelled request never settles', async () => {
    state.upload.mockImplementationOnce(() => new Promise(() => {}));
    const handle = startClipSourceUpload(defaults);
    const rejected = expect(handle.done).rejects.toMatchObject({ code: 'clip-upload-cancelled' });
    await spin(() => state.uploaded.length === 1); handle.cancel(); await rejected;
    expect(state.cancel).toHaveBeenCalledOnce(); expect(state.files.has(source)).toBe(true);
  });

  it('cancels while token acquisition is pending without waiting for auth network completion', async () => {
    state.getToken.mockImplementationOnce(() => new Promise(() => {}));
    const handle = startClipSourceUpload(defaults);
    const rejected = expect(handle.done).rejects.toMatchObject({ code: 'clip-upload-cancelled' });
    await spin(() => state.getToken.mock.calls.length === 1); handle.cancel(); await rejected;
    expect(fetch).not.toHaveBeenCalled(); expect(state.uploaded).toHaveLength(0);
  });

  it('waits for native cancellation before reusing resources and ignores late progress', async () => {
    const progress = vi.fn(); let stopped!: () => void;
    state.cancel.mockImplementationOnce(() => new Promise<void>(resolve => { stopped = resolve; }));
    state.upload.mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(query(0) as any);
    const handle = startClipSourceUpload({ ...defaults, onProgress: progress });
    await spin(() => state.uploaded.length === 1); const first = state.uploaded[0];
    handle.pause(); handle.resume();
    await spin(() => state.cancel.mock.calls.length === 1);
    const before = progress.mock.calls.length;
    first.progress({ totalBytesSent: MIB, totalBytesExpectedToSend: MIB });
    expect(progress.mock.calls).toHaveLength(before); expect(state.uploaded).toHaveLength(1);
    stopped(); await handle.done;
    expect(new Set(state.uploaded.map(row => row.path)).size).toBe(state.uploaded.length);
  });

  it('does not query a denied finalization or mistake it for successful upload', async () => {
    state.files.set(source, 20); state.upload.mockResolvedValueOnce(nativeReply('final', 403));
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refreshes an expired ID token once and checks the session before resuming', async () => {
    state.files.set(source, 20);
    vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(query(0) as any);
    state.upload.mockResolvedValueOnce(nativeReply('active', 401)).mockResolvedValueOnce(nativeReply());
    await startClipSourceUpload(defaults).done;
    expect(state.getToken.mock.calls.filter(([refresh]) => refresh === true)).toHaveLength(1);
    expect(state.uploaded).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({ 'X-Goog-Upload-Command': 'query' });
  });

  it('does not retry repeated authentication rejection forever', async () => {
    vi.mocked(fetch).mockResolvedValue(response(401) as any);
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthenticated' });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.getToken.mock.calls.filter(([refresh]) => refresh === true)).toHaveLength(1);
  });

  it('pauses during forced token refresh and resumes without misreporting an authentication failure', async () => {
    state.files.set(source, 20);
    vi.mocked(fetch).mockResolvedValueOnce(response(401) as any).mockResolvedValueOnce(begin() as any);
    state.getToken.mockResolvedValueOnce('old-token').mockImplementationOnce(() => new Promise(() => {})).mockResolvedValue('new-token');
    const handle = startClipSourceUpload(defaults);
    await spin(() => state.getToken.mock.calls.length === 2); handle.pause();
    await Promise.resolve(); handle.resume(); await handle.done;
    expect(state.getToken.mock.calls[1]).toEqual([true]); expect(state.getToken.mock.calls[2]).toEqual([true]);
    expect(state.uploaded[0].options.headers.Authorization).toBe('Firebase new-token');
  });

  it('does not continue as another signed-in account after a network interruption', async () => {
    state.upload.mockImplementationOnce(async () => { state.auth.currentUser = { uid: 'other', getIdToken: state.getToken }; throw new Error('disconnect'); });
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'clip-session-changed' });
    expect(fetch).toHaveBeenCalledTimes(1); expect(state.uploaded).toHaveLength(1);
  });

  it('rejects untrusted session addresses before exposing authorization or video bytes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(200, { 'X-Goog-Upload-Status': 'active', 'X-Goog-Upload-URL': 'https://evil.example/upload?secret=token' }) as any);
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/invalid-argument', message: 'storage/invalid-argument' });
    expect(state.uploaded).toHaveLength(0); expect(state.reads).toHaveLength(0);
  });

  it('fails after bounded retries without exposing raw transport errors', async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockRejectedValue(new Error('network with secret=https://unsafe?token=x'));
    const rejected = expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/retry-limit-exceeded', message: 'storage/retry-limit-exceeded' });
    await vi.runAllTimersAsync(); await rejected;
    expect(fetch).toHaveBeenCalledTimes(5); expect(state.uploaded).toHaveLength(0);
  });

  it('rejects an impossible final size after a lost response', async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(query(1, 'final') as any);
    state.upload.mockRejectedValueOnce(new Error('disconnect'));
    const rejected = expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/invalid-checksum' });
    await vi.runAllTimersAsync(); await rejected;
  });

  it.each([0, 4 * MIB])('rejects a regressing or oversized server offset %s', async acknowledged => {
    vi.useFakeTimers(); vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(query(acknowledged) as any);
    state.upload.mockResolvedValueOnce(nativeReply('active')).mockRejectedValueOnce(new Error('disconnect'));
    const rejected = expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/invalid-checksum' });
    await vi.runAllTimersAsync(); await rejected;
  });

  it('checks actual file size before making a server request', async () => {
    state.files.set(source, defaults.maxUploadBytes + 1);
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'clip-file-too-large' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('times out a stuck native request and reconciles its final response without reuploading', async () => {
    vi.useFakeTimers(); state.files.set(source, 20);
    state.upload.mockImplementationOnce(() => new Promise(() => {}));
    vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(query(20, 'final') as any);
    const handle = startClipSourceUpload(defaults);
    await vi.runAllTimersAsync(); await handle.done;
    expect(state.cancel).toHaveBeenCalledOnce(); expect(state.uploaded).toHaveLength(1);
  });
});

describe('safe clip upload HTTP diagnostics', () => {
  const deniedBody = JSON.stringify({ error: { code: 403, message: 'Permission denied.' },
    token: 'secret-id-token', sessionUrl: session, localUri: source, downloadTokens: 'secret-download-token' });
  const denied = () => response(403, { 'Content-Type': 'application/json' }, deniedBody);
  const logged = () => vi.mocked(console.warn).mock.calls.map(args => args.join(' '));
  const diagnostic = (operation: string, responseCategory = 'permission-denied') =>
    `[clips-upload-http] operation=${operation} httpStatus=403 code=storage/unauthorized responseCategory=${responseCategory}`;

  it('does not read response bodies or log HTTP diagnostics on success', async () => {
    const started = begin(); started.text.mockRejectedValue(new Error('success body must not be read'));
    vi.mocked(fetch).mockResolvedValueOnce(started as any);
    await startClipSourceUpload(defaults).done;
    expect(started.text).not.toHaveBeenCalled(); expect(console.warn).not.toHaveBeenCalled();
  });

  it('records a denied session start without exposing response fields or changing the failure', async () => {
    const started = denied(); vi.mocked(fetch).mockResolvedValueOnce(started as any);
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    expect(logged()).toEqual([diagnostic('start')]);
    expect(fetch).toHaveBeenCalledTimes(1); expect(state.uploaded).toHaveLength(0);
  });

  it.each([['chunk', 2 * MIB], ['finalize', 20]])('records native %s rejection and keeps authorization failure terminal', async (operation, size) => {
    state.files.set(source, size as number);
    state.upload.mockResolvedValueOnce({ ...nativeReply('active', 403), body: deniedBody });
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    expect(logged()).toEqual([diagnostic(operation as string)]);
    expect(fetch).toHaveBeenCalledTimes(1); expect(state.uploaded).toHaveLength(1);
  });

  it('records query rejection after an interrupted transfer without retrying the denial', async () => {
    vi.useFakeTimers(); vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(denied() as any);
    state.upload.mockRejectedValueOnce(new Error('connection dropped'));
    const rejected = expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await vi.runAllTimersAsync(); await rejected;
    expect(logged()).toEqual([diagnostic('query')]); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('records a bodyless finalize command separately from a successful final data request', async () => {
    state.files.set(source, 20);
    vi.mocked(fetch).mockResolvedValueOnce(begin() as any).mockResolvedValueOnce(denied() as any);
    state.upload.mockResolvedValueOnce(nativeReply('active'));
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    expect(logged()).toEqual([diagnostic('finalize')]);
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({ 'X-Goog-Upload-Command': 'finalize' });
  });

  it('does not read an oversized declared control error body', async () => {
    const started = response(403, { 'Content-Length': String(16 * 1024 + 1) }, deniedBody);
    vi.mocked(fetch).mockResolvedValueOnce(started as any);
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    expect(started.text).not.toHaveBeenCalled(); expect(logged()).toEqual([diagnostic('start', 'unavailable')]);
  });

  it('preserves the HTTP code when reading its diagnostic body fails', async () => {
    const started = denied(); started.text.mockRejectedValue(new Error(`failed at ${session}`));
    vi.mocked(fetch).mockResolvedValueOnce(started as any);
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    expect(logged()).toEqual([diagnostic('start', 'unavailable')]); expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds diagnostic reading to two seconds without turning a 403 into a retryable timeout', async () => {
    vi.useFakeTimers(); const started = denied(); started.text.mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetch).mockResolvedValueOnce(started as any);
    const rejected = expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    await vi.advanceTimersByTimeAsync(2000); await rejected;
    expect(logged()).toEqual([diagnostic('start', 'unavailable')]); expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still honors user cancellation during diagnostic reading', async () => {
    const started = denied(); started.text.mockImplementation(() => new Promise(() => {}));
    vi.mocked(fetch).mockResolvedValueOnce(started as any);
    const handle = startClipSourceUpload(defaults);
    const rejected = expect(handle.done).rejects.toMatchObject({ code: 'clip-upload-cancelled' });
    await spin(() => started.text.mock.calls.length === 1); handle.cancel(); await rejected;
    expect(logged()).toEqual([diagnostic('start', 'unavailable')]); expect(state.uploaded).toHaveLength(0);
  });

  it('cannot replace the HTTP error if the logger itself throws', async () => {
    vi.mocked(console.warn).mockImplementation(() => { throw new Error('logger unavailable'); });
    vi.mocked(fetch).mockResolvedValueOnce(denied() as any);
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never prints an oversized native server body, token, or URL', async () => {
    state.files.set(source, 20);
    state.upload.mockResolvedValueOnce({ ...nativeReply('final', 403), body: 'x'.repeat(16 * 1024 + 1) + deniedBody });
    await expect(startClipSourceUpload(defaults).done).rejects.toMatchObject({ code: 'storage/unauthorized' });
    expect(logged()).toEqual([diagnostic('finalize', 'unknown')]);
  });
});
