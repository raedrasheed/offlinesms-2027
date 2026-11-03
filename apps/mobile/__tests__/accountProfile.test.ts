import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'account-a' } as { uid: string } | null },
  getItem: vi.fn(), setItem: vi.fn(), unsubscribed: [] as string[],
  listeners: new Map<string, (snapshot: any) => void>(),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: mocks.getItem, setItem: mocks.setItem } }));
vi.mock('../src/lib/firebase', () => ({ auth: mocks.auth, db: {} }));
vi.mock('firebase/firestore', () => ({ doc: (_db: unknown, _collection: string, uid: string) => uid,
  onSnapshot: (uid: string, callback: (snapshot: any) => void) => { mocks.listeners.set(uid, callback); return () => mocks.unsubscribed.push(uid); },
}));
import { useAccountProfile } from '../src/hooks/useAccountProfile';
let renderer: ReactTestRenderer | undefined;
let state: ReturnType<typeof useAccountProfile>;
function Harness({ uid }: { uid: string | null }) { state = useAccountProfile(uid); return null; }
function live(uid: string, data: Record<string, unknown>) { mocks.listeners.get(uid)!({ exists: () => true, data: () => data }); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.auth.currentUser = { uid: 'account-a' }; mocks.listeners.clear(); mocks.unsubscribed = [];
  mocks.setItem.mockResolvedValue(undefined); mocks.getItem.mockResolvedValue(null);
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
});
