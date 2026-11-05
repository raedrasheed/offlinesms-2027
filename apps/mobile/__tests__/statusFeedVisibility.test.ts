import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mock = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'viewer' } as { uid: string } | null },
  focused: true, state: 'active', listeners: new Set<(state: string) => void>(),
  invoke: vi.fn(), own: [] as any[], ownCallbacks: [] as ((snapshot: any) => void)[], users: 0, navigation: { navigate: vi.fn() },
}));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', RefreshControl: 'RefreshControl', Image: 'Image', ActivityIndicator: 'Spinner',
  StyleSheet: { create: (styles: unknown) => styles }, Alert: { alert: vi.fn() },
  AppState: { get currentState() { return mock.state; }, addEventListener: (_event: string, listener: (state: string) => void) => { mock.listeners.add(listener); return { remove: () => mock.listeners.delete(listener) }; } },
}));
vi.mock('@react-navigation/native', () => ({
  useIsFocused: () => mock.focused,
  useFocusEffect: (callback: () => void | (() => void)) => useEffect(() => { if (mock.focused) return callback(); }, [callback, mock.focused]),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('expo-image-picker', () => ({}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 12 }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../src/i18n', () => ({ isRTL: false }));
vi.mock('../src/lib/userProfiles', () => ({ useDisplayNames: () => (_uid: string, options: any) => options?.snapshot ?? 'Viewer', useDisplayName: () => 'Viewer', useUserProfiles: () => ({}) }));
vi.mock('../src/context/ThemeContext', () => ({ useTheme: () => ({ colors: { action: { primary: '#123', primaryFg: '#fff' }, background: { app: '#fff', surface: '#fff', subtle: '#eee' }, text: { primary: '#123', muted: '#456', disabled: '#789' }, border: { default: '#aaa', subtle: '#bbb' } } }) }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), doc: vi.fn(), orderBy: vi.fn(), query: vi.fn(), where: vi.fn(), limit: vi.fn(), deleteDoc: vi.fn(), onSnapshot: (_query: unknown, callback: any) => { mock.ownCallbacks.push(callback); callback({ docs: mock.own }); return () => {}; } }));
vi.mock('firebase/storage', () => ({ ref: vi.fn(), uploadBytes: vi.fn(), getDownloadURL: vi.fn() }));
vi.mock('firebase/functions', () => ({ getFunctions: vi.fn(), httpsCallable: (_app: unknown, name: string) => (data: unknown) => mock.invoke(name, data) }));
vi.mock('../src/lib/firebase', () => ({ app: {}, db: {}, storage: {}, auth: mock.auth }));
import Status from '../src/screens/Status';
import { fetchStatusFeed, markStatusViewed } from '../src/lib/statuses';
import type { StatusFeedItem } from '../src/lib/statusModel';
let renderer: ReactTestRenderer | undefined;
const story = (id = 'new-story', expiresAtMs = Date.now() + 120_000): StatusFeedItem => ({ statusId: id, authorId: 'author', authorName: 'Author A', authorPhotoURL: null, type: 'text', body: 'Hello', mediaUrl: null, durationMs: null, backgroundColor: '#123456', createdAtMs: Date.now(), expiresAtMs, viewedByMe: false });
const response = (items: StatusFeedItem[]) => ({ data: { items } });
async function render() { await act(async () => { const element = createElement(Status, { navigation: mock.navigation }); if (renderer) renderer.update(element); else renderer = create(element); }); }
async function step(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
async function appState(state: string) { await act(async () => { mock.state = state; mock.listeners.forEach(listener => listener(state)); }); }
const texts = () => renderer!.root.findAll(node => String(node.type) === 'Text').map(node => node.children.join(''));
const byId = (id: string) => renderer!.root.findByProps({ testID: id });
const hasId = (id: string) => renderer!.root.findAllByProps({ testID: id }).length > 0;
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.auth.currentUser = { uid: `viewer-${++mock.users}` }; mock.focused = true; mock.state = 'active'; mock.own = []; mock.ownCallbacks = []; mock.listeners.clear(); mock.invoke.mockResolvedValue(response([])); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('status feed visibility', () => {
  it('shows a newly published story when opening Status inside the feed cache TTL', async () => {
    await fetchStatusFeed();
    mock.invoke.mockResolvedValue(response([story()]));
    await step(1000); await render();
    expect(mock.invoke).toHaveBeenCalledTimes(2);
    expect(texts()).toContain('Author A');
  });
  it('refreshes newly published stories while the foreground Status tab stays open', async () => {
    await render(); expect(texts()).toContain('status.noUpdatesTitle');
    mock.invoke.mockResolvedValue(response([story()]));
    await step(29_999); expect(mock.invoke).toHaveBeenCalledTimes(1);
    await step(1); expect(mock.invoke).toHaveBeenCalledTimes(2); expect(texts()).toContain('Author A');
  });
  it('stops network and timers in background, and fetches fresh immediately on foreground resume', async () => {
    await render(); await appState('background'); expect(vi.getTimerCount()).toBe(0);
    await step(90_000); expect(mock.invoke).toHaveBeenCalledTimes(1);
    mock.invoke.mockResolvedValue(response([story()]));
    await appState('active'); expect(mock.invoke).toHaveBeenCalledTimes(2); expect(texts()).toContain('Author A');
  });
  it('stops refresh on blur and bypasses the empty cache when focused again', async () => {
    await render(); mock.focused = false; await render(); expect(vi.getTimerCount()).toBe(0);
    await step(1000); expect(mock.invoke).toHaveBeenCalledTimes(1);
    mock.invoke.mockResolvedValue(response([story()])); mock.focused = true; await render();
    expect(mock.invoke).toHaveBeenCalledTimes(2); expect(texts()).toContain('Author A');
  });
  it('does not fetch when mounted hidden or in background', async () => {
    mock.focused = false; await render(); await step(60_000); expect(mock.invoke).not.toHaveBeenCalled();
    await appState('background'); mock.focused = true; await render(); await step(60_000); expect(mock.invoke).not.toHaveBeenCalled();
    await appState('active'); expect(mock.invoke).toHaveBeenCalledOnce();
  });
  it('shows loading until a successful empty response, instead of claiming no updates prematurely', async () => {
    let resolve!: (value: unknown) => void;
    mock.invoke.mockReturnValue(new Promise(done => { resolve = done; }));
    await render(); expect(hasId('status-feed-loading')).toBe(true); expect(texts()).not.toContain('status.noUpdatesTitle');
    await act(async () => resolve(response([])));
    expect(hasId('status-feed-loading')).toBe(false); expect(texts()).toContain('status.noUpdatesTitle');
  });
  it('distinguishes a failed request from empty results and retries successfully', async () => {
    mock.invoke.mockRejectedValueOnce(new Error('permission-denied'));
    await render(); expect(hasId('status-feed-error')).toBe(true); expect(texts()).not.toContain('status.noUpdatesTitle');
    mock.invoke.mockResolvedValue(response([story()])); await act(async () => byId('status-feed-retry').props.onPress());
    expect(hasId('status-feed-error')).toBe(false); expect(texts()).toContain('Author A');
  });
  it('keeps cached rows with an error banner and does not let view-cache changes erase the request failure', async () => {
    mock.invoke.mockResolvedValue(response([story()])); await render();
    mock.invoke.mockImplementation((name: string) => name === 'markStatusViewed' ? Promise.resolve({ data: { ok: true } }) : Promise.reject(new Error('unavailable')));
    await step(30_000); expect(hasId('status-feed-error')).toBe(true); expect(texts()).toContain('Author A');
    await act(async () => markStatusViewed('new-story'));
    expect(hasId('status-feed-error')).toBe(true); expect(texts()).toContain('status.viewedUpdates');
  });
  it('receives feed cache changes made by another visible feature', async () => {
    await render(); mock.invoke.mockResolvedValue(response([story()]));
    await act(async () => { await fetchStatusFeed(true); });
    expect(texts()).toContain('Author A');
  });
  it('removes expired rows without another network request', async () => {
    mock.invoke.mockResolvedValue(response([story('short', Date.now() + 1000)])); await render();
    expect(texts()).toContain('Author A'); await step(1000);
    expect(texts()).not.toContain('Author A'); expect(texts()).toContain('status.noUpdatesTitle'); expect(mock.invoke).toHaveBeenCalledOnce();
  });
  it('deduplicates manual and periodic refresh while a callable is pending', async () => {
    let resolve!: (value: unknown) => void;
    mock.invoke.mockReturnValue(new Promise(done => { resolve = done; })); await render();
    await act(async () => renderer!.root.find(node => String(node.type) === 'ScrollView').props.refreshControl.props.onRefresh()); await step(30_000);
    expect(mock.invoke).toHaveBeenCalledOnce();
    await act(async () => resolve(response([story()]))); expect(texts()).toContain('Author A');
  });
  it('hides old-account own stories and ignores its late callable and snapshot completions', async () => {
    let resolveA!: (value: unknown) => void;
    mock.own = [{ id: 'own-a', data: () => ({ type: 'text', body: 'Account A', createdAt: { toMillis: () => Date.now() }, expiresAt: { toMillis: () => Date.now() + 60_000 } }) }];
    mock.invoke.mockReturnValue(new Promise(done => { resolveA = done; })); await render(); const oldOwn = mock.ownCallbacks[0], oldDocs = mock.own;
    mock.auth.currentUser = { uid: `viewer-${++mock.users}` }; mock.own = [];
    mock.invoke.mockResolvedValue(response([{ ...story(), authorName: 'Account B story' }])); await render();
    await act(async () => { oldOwn({ docs: oldDocs }); resolveA(response([{ ...story(), authorName: 'Account A story' }])); });
    expect(texts()).toContain('Account B story'); expect(texts()).not.toContain('Account A story');
    await act(async () => byId('status-my-status').props.onPress()); expect(mock.navigation.navigate).toHaveBeenLastCalledWith('StatusComposer');
  });
  it('ignores an old response after logout and does not schedule further requests', async () => {
    let resolve!: (value: unknown) => void;
    mock.invoke.mockReturnValue(new Promise(done => { resolve = done; })); await render();
    mock.auth.currentUser = null; await render(); await act(async () => resolve(response([story()]))); await step(90_000);
    expect(texts()).not.toContain('Author A'); expect(mock.invoke).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up refresh and expiry timers on unmount', async () => {
    mock.invoke.mockResolvedValue(response([story()])); await render();
    await act(async () => renderer!.unmount()); renderer = undefined; expect(vi.getTimerCount()).toBe(0); expect(mock.listeners.size).toBe(0);
    await step(90_000); expect(mock.invoke).toHaveBeenCalledOnce();
  });
});
