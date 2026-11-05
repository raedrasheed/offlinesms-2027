import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'account-a' } as { uid: string } | null },
  getItem: vi.fn(), setItem: vi.fn(), getServer: vi.fn(), unsubscribed: [] as string[],
  documents: new Map<string, any>(), errors: new Map<string, () => void>(),
  listeners: new Map<string, (snapshot: any) => void>(), metadataSubscriptions: [] as boolean[],
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: mocks.getItem, setItem: mocks.setItem } }));
vi.mock('../src/lib/firebase', () => ({ auth: mocks.auth, db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, _collection: string, uid: string) => uid,
  getDocFromServer: mocks.getServer,
  onSnapshot: (uid: string, options: { includeMetadataChanges: boolean }, callback: (snapshot: any) => void, error: () => void) => { mocks.metadataSubscriptions.push(options.includeMetadataChanges); mocks.listeners.set(uid, callback); mocks.errors.set(uid, error); return () => mocks.unsubscribed.push(uid); },
}));
import { useAccountProfile } from '../src/hooks/useAccountProfile';
let renderer: ReactTestRenderer | undefined;
let state: ReturnType<typeof useAccountProfile>;
const renders: Array<{ uid: string | null; profileCompleted: boolean | null }> = [];
function Harness({ uid }: { uid: string | null }) { state = useAccountProfile(uid); renders.push({ uid, profileCompleted: state.profileCompleted }); return null; }
function snapshot(data: Record<string, unknown> | null, fromCache = false, hasPendingWrites = false) { return { exists: () => data !== null, data: () => data, metadata: { fromCache, hasPendingWrites } }; }
function live(uid: string, data: Record<string, unknown> | null, fromCache = false, hasPendingWrites = false) {
  mocks.documents.set(uid, data); mocks.listeners.get(uid)!(snapshot(data, fromCache, hasPendingWrites));
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.auth.currentUser = { uid: 'account-a' }; mocks.listeners.clear(); mocks.errors.clear(); mocks.documents.clear(); mocks.unsubscribed = []; mocks.metadataSubscriptions = []; renders.length = 0;
  mocks.setItem.mockResolvedValue(undefined); mocks.getItem.mockResolvedValue(null);
  mocks.getServer.mockImplementation(async (uid: string) => snapshot(mocks.documents.get(uid) ?? null));
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
describe('account-bound navigation profile', () => {
  it('drops onboarding and theme immediately on direct account switches and ignores old callbacks', async () => {
    await act(async () => { renderer = create(createElement(Harness, { uid: 'account-a' })); });
    await act(async () => live('account-a', { profileCompleted: true, preferredTheme: 'dark' }));
    expect(state).toMatchObject({ profileCompleted: true, userTheme: 'dark' });
    mocks.auth.currentUser = { uid: 'account-b' };
    await act(async () => renderer!.update(createElement(Harness, { uid: 'account-b' })));
    expect(state).toMatchObject({ uid: 'account-b', profileCompleted: null, userTheme: null });
    expect(mocks.unsubscribed).toContain('account-a');
    await act(async () => live('account-a', { profileCompleted: true, preferredTheme: 'dark' }));
    expect(state.profileCompleted).toBeNull();
    await act(async () => live('account-b', { profileCompleted: false }));
    expect(state).toMatchObject({ profileCompleted: false, userTheme: null });
  });
  it('does not let a late previous-account cache unlock the next account', async () => {
    let finish!: (value: string) => void;
    mocks.getItem.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(null);
    await act(async () => { renderer = create(createElement(Harness, { uid: 'account-a' })); });
    mocks.auth.currentUser = { uid: 'account-b' };
    await act(async () => renderer!.update(createElement(Harness, { uid: 'account-b' })));
    await act(async () => finish('1'));
    expect(state.profileCompleted).toBeNull();
  });
  it('retains offline startup for the same account, with live data taking precedence', async () => {
    let finish!: (value: string) => void;
    mocks.getItem.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { renderer = create(createElement(Harness, { uid: 'account-a' })); });
    await act(async () => live('account-a', { profileCompleted: false }));
    await act(async () => finish('1'));
    expect(state.profileCompleted).toBe(false);
    await act(async () => renderer!.unmount()); renderer = undefined;
    mocks.getItem.mockResolvedValue('1');
    await act(async () => { renderer = create(createElement(Harness, { uid: 'account-a' })); });
    expect(state.profileCompleted).toBe(true);
  });
  it('keeps offline completion when an empty cached document arrives before the persisted flag', async () => {
    let finish!: (value: string) => void;
    mocks.getItem.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => { renderer = create(createElement(Harness, { uid: 'account-a' })); });
    await act(async () => live('account-a', null, true));
    expect(mocks.setItem).not.toHaveBeenCalled();
    await act(async () => finish('1'));
    expect(state.profileCompleted).toBe(true);
    // The same missing document, now confirmed by the server, must still
    // reach the listener and revoke the cached onboarding completion.
    expect(mocks.metadataSubscriptions).toEqual([true]);
    await act(async () => live('account-a', null, false));
    expect(state.profileCompleted).toBe(false);
    expect(mocks.setItem).toHaveBeenLastCalledWith('profileCompleted.v1:account-a', '0');
  });
  it('keeps completion through stale cache updates, then honors a server-confirmed incomplete profile', async () => {
    mocks.getItem.mockResolvedValue('1');
    await act(async () => { renderer = create(createElement(Harness, { uid: 'account-a' })); });
    await act(async () => live('account-a', { profileCompleted: false }, true));
    expect(state.profileCompleted).toBe(true); expect(mocks.setItem).not.toHaveBeenCalled();
    await act(async () => live('account-a', { profileCompleted: false }, false));
    expect(state.profileCompleted).toBe(false);
  });
});

describe('verified onboarding without startup flashes', () => {
  async function mount() { await act(async () => { renderer = create(createElement(Harness, { uid: 'account-a' })); }); }
  it('never mounts onboarding while persisted incomplete data and a negative snapshot are still being verified', async () => {
    mocks.getItem.mockResolvedValue('0');
    let finish!: (value: any) => void;
    mocks.getServer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await act(async () => live('account-a', { profileCompleted: false }));
    expect(state.profileCompleted).toBeNull(); expect(mocks.setItem).not.toHaveBeenCalled();
    await act(async () => { finish(snapshot({ profileCompleted: true, preferredTheme: 'dark' })); });
    expect(state).toMatchObject({ profileCompleted: true, userTheme: 'dark', profileError: false });
    expect(renders.some(frame => frame.profileCompleted === false)).toBe(false);
  });
  it('opens onboarding for a genuinely incomplete account only after the fresh server read confirms it', async () => {
    let finish!: (value: any) => void;
    mocks.getServer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await act(async () => live('account-a', { profileCompleted: false }));
    expect(state.profileCompleted).toBeNull();
    await act(async () => { finish(snapshot({ profileCompleted: false })); });
    expect(state.profileCompleted).toBe(false);
    expect(mocks.setItem).toHaveBeenLastCalledWith('profileCompleted.v1:account-a', '0');
    await act(async () => live('account-a', { profileCompleted: true }));
    expect(state.profileCompleted).toBe(true);
    expect(mocks.setItem).toHaveBeenLastCalledWith('profileCompleted.v1:account-a', '1');
  });
  it('ignores unacknowledged writes even when Firestore reports fromCache=false', async () => {
    await mount(); await act(async () => live('account-a', { profileCompleted: false }, false, true));
    expect(state.profileCompleted).toBeNull(); expect(mocks.getServer).not.toHaveBeenCalled();
    await act(async () => live('account-a', { profileCompleted: true }, false, true));
    expect(state.profileCompleted).toBeNull(); expect(mocks.setItem).not.toHaveBeenCalled();
    await act(async () => live('account-a', { profileCompleted: true }));
    expect(state.profileCompleted).toBe(true); expect(mocks.getServer).not.toHaveBeenCalled();
  });
  it('discards a late incomplete verification after a newer completed snapshot', async () => {
    let finish!: (value: any) => void;
    mocks.getServer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await act(async () => live('account-a', null));
    await act(async () => live('account-a', { profileCompleted: true }));
    await act(async () => { finish(snapshot(null)); });
    expect(state.profileCompleted).toBe(true);
    expect(renders.some(frame => frame.profileCompleted === false)).toBe(false);
    expect(mocks.setItem).toHaveBeenLastCalledWith('profileCompleted.v1:account-a', '1');
  });
  it('shows a retryable verification error, never onboarding, when a server read fails', async () => {
    mocks.getServer.mockRejectedValueOnce(new Error('offline'));
    await mount(); await act(async () => live('account-a', { profileCompleted: false }));
    expect(state).toMatchObject({ profileCompleted: null, profileError: true });
    expect(renders.some(frame => frame.profileCompleted === false)).toBe(false);
    await act(async () => { state.retryProfile(); });
    expect(state.profileError).toBe(false);
    expect(mocks.unsubscribed).toContain('account-a');
    await act(async () => live('account-a', { profileCompleted: true }));
    expect(state).toMatchObject({ profileCompleted: true, profileError: false });
  });
  it('keeps the same completed account usable offline when verification or the listener fails', async () => {
    mocks.getItem.mockResolvedValue('1'); mocks.getServer.mockRejectedValueOnce(new Error('offline'));
    await mount(); await act(async () => live('account-a', { profileCompleted: false }));
    expect(state.profileCompleted).toBe(true);
    await act(async () => { mocks.errors.get('account-a')!(); });
    expect(state.profileCompleted).toBe(true);
    expect(renders.some(frame => frame.profileCompleted === false)).toBe(false);
    expect(mocks.setItem).not.toHaveBeenCalled();
  });
  it('does not accept an old account’s verification or persist its result after switching accounts', async () => {
    let finish!: (value: any) => void;
    mocks.getServer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await act(async () => live('account-a', { profileCompleted: false }));
    mocks.auth.currentUser = { uid: 'account-b' };
    await act(async () => renderer!.update(createElement(Harness, { uid: 'account-b' })));
    await act(async () => { finish(snapshot({ profileCompleted: false })); });
    expect(state).toMatchObject({ uid: 'account-b', profileCompleted: null });
    expect(mocks.setItem).not.toHaveBeenCalled();
  });
  it('ignores a stale verification after unmount and a cold restart for the same account', async () => {
    let finish!: (value: any) => void;
    mocks.getServer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await act(async () => live('account-a', { profileCompleted: false }));
    await act(async () => renderer!.unmount()); renderer = undefined;
    mocks.getItem.mockResolvedValue('1'); renders.length = 0; await mount();
    await act(async () => { finish(snapshot({ profileCompleted: false })); });
    expect(state.profileCompleted).toBe(true);
    expect(renders.some(frame => frame.profileCompleted === false)).toBe(false);
    expect(mocks.setItem).not.toHaveBeenCalled();
  });
  it('invalidates an older response when retry starts a new subscription', async () => {
    let finish!: (value: any) => void;
    mocks.getServer.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(); await act(async () => live('account-a', { profileCompleted: false }));
    await act(async () => { state.retryProfile(); });
    await act(async () => { finish(snapshot({ profileCompleted: false })); });
    expect(state.profileCompleted).toBeNull();
    await act(async () => live('account-a', { profileCompleted: true }));
    expect(state.profileCompleted).toBe(true);
    expect(renders.some(frame => frame.profileCompleted === false)).toBe(false);
  });
  it('rechecks a server-confirmed missing profile but does not treat an empty offline cache as missing', async () => {
    await mount(); await act(async () => live('account-a', null, true));
    expect(state.profileCompleted).toBeNull(); expect(mocks.getServer).not.toHaveBeenCalled();
    await act(async () => live('account-a', null));
    expect(state.profileCompleted).toBe(false); expect(mocks.getServer).toHaveBeenCalledWith('account-a');
  });
});
