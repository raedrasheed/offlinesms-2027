import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClipDraft } from '../src/lib/clipDrafts';
const mocks = vi.hoisted(() => ({ auth: { currentUser: { uid: 'me' } }, remote: vi.fn(), local: vi.fn(), save: vi.fn() }));
vi.mock('../src/lib/firebase', () => ({ auth: mocks.auth }));
vi.mock('../src/lib/clips', () => ({ getClip: mocks.remote }));
vi.mock('../src/lib/clipDrafts', () => ({ getClipDraft: mocks.local, saveClipDraft: mocks.save }));
import { reconcileClipDraftStatus } from '../src/lib/clipDraftStatus';
const draft = { id: 'draft1', uid: 'me', clipId: 'clip1', status: 'processing', caption: 'original' } as ClipDraft;
beforeEach(() => { vi.clearAllMocks(); mocks.auth.currentUser = { uid: 'me' }; mocks.remote.mockResolvedValue({ status: 'failed' }); mocks.local.mockResolvedValue({ ...draft, caption: 'latest local edit' }); mocks.save.mockImplementation(async value => value); });
describe('Processing draft recovery', () => {
  it('unlocks retry on a confirmed failure while preserving the current local edits and upload id', async () => { expect(await reconcileClipDraftStatus(draft)).toMatchObject({ status: 'failed', clipId: 'clip1', caption: 'latest local edit' }); });
  it('preserves processing when offline or when the server still processes it', async () => { mocks.remote.mockRejectedValueOnce(new Error('offline')); expect((await reconcileClipDraftStatus(draft)).status).toBe('processing'); mocks.remote.mockResolvedValueOnce({ status: 'processing' }); expect((await reconcileClipDraftStatus(draft)).status).toBe('processing'); expect(mocks.save).not.toHaveBeenCalled(); });
  it('does not persist old-account state after an account switch during the lookup', async () => { mocks.remote.mockImplementationOnce(async () => { mocks.auth.currentUser = { uid: 'new' }; return { status: 'failed' }; }); await reconcileClipDraftStatus(draft); expect(mocks.save).not.toHaveBeenCalled(); });
});
