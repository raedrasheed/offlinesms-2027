import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'owner' } as { uid: string } | null }, storage: new Map<string, string>(), files: new Set<string>(),
  calls: [] as Array<{ name: string; data: any }>, tasks: [] as any[], sequence: 0,
  network: null as null | ((value: any) => void), authChanged: null as null | ((value: any) => void),
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
  return { data: name === 'initClipUpload' ? { clipId: `server-${data.draftId}`, storagePath: `source/${data.draftId}`, maxUploadBytes: 1000, status: 'uploading' }
    : { clipId: data.clipId, status: 'processing' } };
} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_: any, callback: any) => {
  state.authChanged = callback; return () => { state.authChanged = null; };
} }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: (callback: any) => {
  state.network = callback; return () => { state.network = null; };
} } }));
vi.mock('firebase/storage', () => ({ ref: (_: any, path: string) => path, uploadBytesResumable: (path: string, blob: Blob, metadata: any) => {
  let change: any, fail: any, complete: any;
  const task = { path, metadata, snapshot: { bytesTransferred: 0, totalBytes: blob.size, state: 'running' },
    on: (_: any, next: any, error: any, done: any) => { change = next; fail = error; complete = done; },
    pause: vi.fn(() => { task.snapshot.state = 'paused'; change?.(task.snapshot); return true; }),
    resume: vi.fn(() => { task.snapshot.state = 'running'; change?.(task.snapshot); return true; }),
    cancel: vi.fn(() => { fail?.(new Error('storage/canceled')); return true; }),
    finish: () => { task.snapshot.bytesTransferred = blob.size; change?.(task.snapshot); complete(); },
  };
  state.tasks.push(task); return task;
} }));
import { createClipDraft, deleteClipDraft, getClipDraft, listClipDrafts, saveClipDraft, clearClipDraftsForAccount } from '../src/lib/clipDrafts';
import { startClipUpload } from '../src/lib/clipUploads';

beforeEach(() => {
  state.auth.currentUser = { uid: 'owner' }; state.storage.clear(); state.files.clear(); state.calls = []; state.tasks = [];
  state.authChanged = null; state.network = null;
  vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['video']) })));
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
    const value = await draft(), handle = await startClipUpload(value); const task = await taskReady();
    state.network!({ isConnected: false }); expect(task.pause).toHaveBeenCalledOnce();
    state.network!({ isConnected: true }); expect(task.resume).toHaveBeenCalledOnce();
    handle.pause(); state.network!({ isConnected: false }); state.network!({ isConnected: true });
    expect(task.resume).toHaveBeenCalledOnce();
    handle.resume(); expect(task.resume).toHaveBeenCalledTimes(2);
    task.finish(); await expect(handle.done).resolves.toEqual({ clipId: `server-${value.id}`, status: 'processing' });
    expect(state.calls.find(c => c.name === 'publishClip')?.data).toMatchObject({ trimStartMs: 500, trimEndMs: 2500,
      coverTimeMs: 1000, caption: 'نص', overlayText: 'مرحبا', mute: true, audience: 'public' });
    expect(task.metadata).toEqual({ contentType: 'video/mp4' });
    expect(await getClipDraft(value.id)).toMatchObject({ status: 'processing', clipId: `server-${value.id}` });
    expect(state.network).toBeNull(); expect(state.authChanged).toBeNull();
  });
  it('cancel retains the copied draft and retry reuses its server reservation', async () => {
    const value = await draft(), handle = await startClipUpload(value); await taskReady();
    const cancelled = expect(handle.done).rejects.toThrow('storage/canceled'); handle.cancel(); await cancelled;
    const saved = await getClipDraft(value.id); expect(saved?.status).toBe('draft'); expect(state.files.has(value.localUri)).toBe(true);
    const retry = await startClipUpload(saved!); const task = await taskReady(2); task.finish(); await retry.done;
    expect(state.calls.filter(c => c.name === 'initClipUpload').map(c => c.data.draftId)).toEqual([value.id, value.id]);
    expect(state.calls.filter(c => c.name === 'publishClip')).toHaveLength(1);
  });
  it('cancels immediately on account switch and never publishes as the next account', async () => {
    const value = await draft(), handle = await startClipUpload(value), task = await taskReady();
    const cancelled = expect(handle.done).rejects.toThrow('storage/canceled');
    state.auth.currentUser = { uid: 'other' }; state.authChanged!(state.auth.currentUser); await cancelled;
    expect(task.cancel).toHaveBeenCalledOnce(); expect(state.calls.some(c => c.name === 'publishClip')).toBe(false);
    expect(await listClipDrafts()).toEqual([]);
  });
});
