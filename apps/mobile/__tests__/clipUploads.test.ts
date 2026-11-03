import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'owner' } as { uid: string } | null }, storage: new Map<string, string>(), files: new Set<string>(),
  calls: [] as Array<{ name: string; data: any }>, tasks: [] as any[], sequence: 0,
  network: null as null | ((value: any) => void), authChanged: null as null | ((value: any) => void),
  callError: null as null | { name: string; error: Error }, initStatus: 'uploading',
}));
vi.mock('../src/lib/firebase', () => ({ auth: state.auth, app: {}, storage: {} }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => state.storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { state.storage.set(key, value); },
  removeItem: async (key: string) => { state.storage.delete(key); },
} }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `draft-${++state.sequence}` }));
vi.mock('expo-file-system', () => ({ documentDirectory: 'file:///documents/',
  makeDirectoryAsync: async () => {},
  copyAsync: async ({ to }: any) => { state.files.add(to); },
  getInfoAsync: async (path: string) => ({ exists: state.files.has(path), size: 5, isDirectory: false }),
  deleteAsync: async (path: string) => { for (const entry of state.files) if (entry.startsWith(path)) state.files.delete(entry); },
}));
vi.mock('firebase/functions', () => ({ getFunctions: () => ({}), httpsCallable: (_: any, name: string) => async (data: any) => {
  state.calls.push({ name, data });
  if (state.callError?.name === name) throw state.callError.error;
  return { data: name === 'initClipUpload' ? { clipId: `server-${data.draftId}`, storagePath: `source/${data.draftId}`, maxUploadBytes: 1000, status: state.initStatus }
    : { clipId: data.clipId, status: 'processing' } };
} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_: any, callback: any) => {
  state.authChanged = callback; return () => { state.authChanged = null; };
} }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: (callback: any) => {
  state.network = callback; return () => { state.network = null; };
} } }));
vi.mock('../src/lib/clipSourceUpload', () => ({ startClipSourceUpload: (input: any) => {
  let fail!: (error: Error) => void, complete!: () => void;
  const emit = (state: string, transferredBytes = 0) => input.onProgress({ transferredBytes, totalBytes: 5, progress: transferredBytes / 5, state });
  const task = { input,
    done: new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; }),
    pause: vi.fn(() => emit('paused')),
    resume: vi.fn(() => emit('running')),
    cancel: vi.fn(() => fail(new Error('clip-upload-cancelled'))),
    finish: () => { emit('running', 5); complete(); },
    fail: (error: Error) => fail(error),
  };
  state.tasks.push(task); return task;
} }));
import { createClipDraft, deleteClipDraft, getClipDraft, listClipDrafts, saveClipDraft, clearClipDraftsForAccount } from '../src/lib/clipDrafts';
import { startClipUpload } from '../src/lib/clipUploads';

beforeEach(() => {
  state.auth.currentUser = { uid: 'owner' }; state.storage.clear(); state.files.clear(); state.calls = []; state.tasks = [];
  state.authChanged = null; state.network = null;
  state.callError = null; state.initStatus = 'uploading';
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Local video must not be read through fetch/Blob'); }));
});
const draft = async () => ({ ...await createClipDraft({ uri: 'file:///picker/cache.mp4', mimeType: 'video/mp4', durationMs: 5000 }),
  audience: 'public' as const, caption: 'نص', trimStartMs: 500, trimEndMs: 2500, coverTimeMs: 1000, overlayText: 'مرحبا', mute: true });
async function taskReady(count = 1) { await vi.waitFor(() => expect(state.tasks).toHaveLength(count)); return state.tasks[count - 1]; }

describe('durable per-account clip drafts', () => {
  it('copies picker bytes to document storage, preserves edits, and isolates account ownership', async () => {
    const value = await draft(); await saveClipDraft(value);
    expect(value.localUri).toMatch(/^file:\/\/\/documents\/clip-drafts\/owner\/draft-\d+\.mp4$/);
    expect(state.files.has(value.localUri)).toBe(true);
    expect(await getClipDraft(value.id)).toMatchObject({ caption: 'نص', trimStartMs: 500, mute: true });
    state.auth.currentUser = { uid: 'other' };
    expect(await listClipDrafts()).toEqual([]);
    await expect(saveClipDraft(value)).rejects.toThrow('clip-draft-owner-mismatch');
    state.auth.currentUser = { uid: 'owner' };
    expect(await getClipDraft(value.id)).not.toBeNull();
    await deleteClipDraft(value.id); expect(state.files.has(value.localUri)).toBe(false);
    expect(await listClipDrafts()).toEqual([]);
  });
  it('removes only the requested account folder during account deletion', async () => {
    const owner = await draft();
    state.auth.currentUser = { uid: 'other' }; const other = await draft();
    await clearClipDraftsForAccount('owner');
    expect(state.files.has(owner.localUri)).toBe(false); expect(state.files.has(other.localUri)).toBe(true);
    expect(await listClipDrafts()).toHaveLength(1);
  });
});

describe('resumable clip upload controls', () => {
  it('resumes network interruptions, respects manual pause, and publishes persisted edits after completion', async () => {
    const onProgress = vi.fn();
    const value = await draft(), handle = await startClipUpload(value, { onProgress }); const task = await taskReady();
    state.network!({ isConnected: false }); expect(task.pause).toHaveBeenCalledOnce();
    state.network!({ isConnected: true }); expect(task.resume).toHaveBeenCalledOnce();
    handle.pause(); state.network!({ isConnected: false }); state.network!({ isConnected: true });
    expect(task.resume).toHaveBeenCalledOnce();
    handle.resume(); expect(task.resume).toHaveBeenCalledTimes(2);
    task.finish(); await expect(handle.done).resolves.toEqual({ clipId: `server-${value.id}`, status: 'processing' });
    expect(state.calls.find(c => c.name === 'publishClip')?.data).toMatchObject({ trimStartMs: 500, trimEndMs: 2500,
      coverTimeMs: 1000, caption: 'نص', overlayText: 'مرحبا', mute: true, audience: 'public' });
    expect(task.input).toMatchObject({ uid: 'owner', localUri: value.localUri, contentType: 'video/mp4', maxUploadBytes: 1000 });
    expect(fetch).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith({ transferredBytes: 5, totalBytes: 5, progress: 1, state: 'processing' });
    expect(await getClipDraft(value.id)).toMatchObject({ status: 'processing', clipId: `server-${value.id}` });
    expect(state.network).toBeNull(); expect(state.authChanged).toBeNull();
  });
  it('cancel retains the copied draft and retry reuses its server reservation', async () => {
    const value = await draft(), handle = await startClipUpload(value); await taskReady();
    const cancelled = expect(handle.done).rejects.toThrow('clip-upload-cancelled'); handle.cancel(); await cancelled;
    const saved = await getClipDraft(value.id); expect(saved?.status).toBe('draft'); expect(state.files.has(value.localUri)).toBe(true);
    const retry = await startClipUpload(saved!); const task = await taskReady(2); task.finish(); await retry.done;
    expect(state.calls.filter(c => c.name === 'initClipUpload').map(c => c.data.draftId)).toEqual([value.id, value.id]);
    expect(state.calls.filter(c => c.name === 'publishClip')).toHaveLength(1);
  });
  it('cancels immediately on account switch and never publishes as the next account', async () => {
    const value = await draft(), handle = await startClipUpload(value), task = await taskReady();
    const cancelled = expect(handle.done).rejects.toThrow('clip-session-changed');
    state.auth.currentUser = { uid: 'other' }; state.authChanged!(state.auth.currentUser); await cancelled;
    expect(task.cancel).toHaveBeenCalledOnce(); expect(state.calls.some(c => c.name === 'publishClip')).toBe(false);
    expect(await listClipDrafts()).toEqual([]);
  });
  it('does not publish when native source upload fails and retains a sanitized retryable draft', async () => {
    const value = await draft(), handle = await startClipUpload(value), task = await taskReady();
    const rejected = expect(handle.done).rejects.toMatchObject({ code: 'storage/unauthorized', clipUploadStage: 'upload' });
    task.fail(Object.assign(new Error('Sensitive response URL must not be stored'), { code: 'storage/unauthorized' }));
    await rejected;
    expect(state.calls.some(c => c.name === 'publishClip')).toBe(false);
    expect(await getClipDraft(value.id)).toMatchObject({ status: 'failed', errorCode: 'storage/unauthorized' });
    expect(state.files.has(value.localUri)).toBe(true);
    expect(state.network).toBeNull(); expect(state.authChanged).toBeNull();
  });
  it('distinguishes publication failure and recovers a lost response without uploading twice', async () => {
    state.callError = { name: 'publishClip', error: Object.assign(new Error('timeout'), { code: 'functions/deadline-exceeded' }) };
    const value = await draft(), handle = await startClipUpload(value), task = await taskReady();
    const rejected = expect(handle.done).rejects.toMatchObject({ clipUploadStage: 'publish' });
    task.finish(); await rejected;
    const saved = await getClipDraft(value.id); expect(saved?.status).toBe('failed');
    state.callError = null; state.initStatus = 'processing';
    const retry = await startClipUpload(saved!); await retry.done;
    expect(state.tasks).toHaveLength(1);
    expect(state.calls.filter(c => c.name === 'publishClip')).toHaveLength(1);
    const recovered = await getClipDraft(value.id);
    expect(recovered?.status).toBe('processing'); expect(recovered?.errorCode).toBeUndefined();
  });
  it('rejects a failed reservation without starting a native upload', async () => {
    state.callError = { name: 'initClipUpload', error: Object.assign(new Error('clip-upload-daily-limit'), { code: 'functions/resource-exhausted' }) };
    const value = await draft(), handle = await startClipUpload(value);
    await expect(handle.done).rejects.toMatchObject({ clipUploadStage: 'initialize' });
    expect(state.tasks).toHaveLength(0);
    expect(state.calls.some(c => c.name === 'publishClip')).toBe(false);
    expect(await getClipDraft(value.id)).toMatchObject({ status: 'failed', errorCode: 'clip-upload-daily-limit' });
  });
});
