import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mock = vi.hoisted(() => ({ mark: vi.fn(), like: vi.fn(), list: vi.fn(), reply: vi.fn(), get: vi.fn(), remove: vi.fn(), prefetch: vi.fn(), nav: { goBack: vi.fn(), replace: vi.fn() }, appListener: undefined as undefined | ((state: string) => void) }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', Image: Object.assign((props: any) => createElement('Image', props), { prefetch: mock.prefetch }), ActivityIndicator: 'Spinner', Modal: 'Modal', FlatList: 'FlatList', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, Alert: { alert: vi.fn() }, Easing: { linear: (n: number) => n },
  StyleSheet: { create: (value: unknown) => value }, AppState: { currentState: 'active', addEventListener: (_event: string, listener: (state: string) => void) => { mock.appListener = listener; return { remove: vi.fn() }; } },
  Animated: { View: 'AnimatedView', Value: class { setValue() {} interpolate() { return 0; } }, timing: (_value: unknown, options: { duration: number }) => { let timer: ReturnType<typeof setTimeout>; let done: (r: { finished: boolean }) => void; return { start: (cb: typeof done) => { done = cb; timer = setTimeout(() => cb({ finished: true }), options.duration); }, stop: () => { clearTimeout(timer); done?.({ finished: false }); } }; } },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: any) => options?.defaultValue ?? key }) }));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 12 }) }));
vi.mock('../src/components/VideoPlayer', () => ({ VideoPlayer: (props: any) => createElement('Video', { testID: props.nativeTestID, source: {uri: props.uri}, shouldPlay: !props.paused, onReadyForDisplay: props.onReady, onPlaybackStatusUpdate: props.onStatus, onError: props.onError }) }));
vi.mock('expo-av', () => ({ Video: 'Video', ResizeMode: { CONTAIN: 'contain' } }));
vi.mock('../src/lib/statuses', () => ({ markStatusViewed: mock.mark, deleteStatus: mock.remove, subscribeStatusViewCount: (_id: string, cb: (n: number) => void) => { cb(3); return () => {}; }, setStatusLike: mock.like, listStatusViewers: mock.list, replyToStatus: mock.reply, getStatus: mock.get }));
import StatusViewer from '../src/screens/StatusViewer';
let renderer: ReactTestRenderer;
const item = (id: string, type = 'image') => ({ statusId: id, type, body: id, mediaUrl: `https://media/${id}`, backgroundColor: '#123456', createdAtMs: 1000 });
async function mount(items = [item('first'), item('second')], extra = {}) { await act(async () => { renderer = create(createElement(StatusViewer, { route: { params: { title: 'Author', authorPhotoURL: 'https://media/avatar', items, ...extra } }, navigation: mock.nav })); }); }
const byId = (id: string) => renderer.root.findByProps({ testID: id });
async function step(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
async function imageReady() { await act(async () => { byId('status-image').props.onLoad(); }); }
async function tapNext() { await act(async () => { byId('status-next').props.onPressIn(); }); await act(async () => { byId('status-next').props.onPressOut(); byId('status-next').props.onPress(); }); }
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.mark.mockResolvedValue(undefined); mock.prefetch.mockResolvedValue(true); mock.like.mockResolvedValue({ liked: true, likeCount: 1 }); mock.list.mockResolvedValue({ viewers: [], next: null }); mock.get.mockImplementation(async (id: string) => ({item: { statusId:id, expiresAtMs: Date.now() + 60_000 }, isMine:false})); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('story playback and interactions', () => {
  it('does not display a cached story when the server denies current access', async () => {
    mock.get.mockRejectedValueOnce(new Error('permission-denied'));
    await mount();
    expect(renderer.root.findAllByProps({ testID: 'status-image' })).toHaveLength(0);
    expect(mock.mark).not.toHaveBeenCalled();
  });
  it('hides media when its validated expiry is reached', async () => {
    mock.get.mockResolvedValueOnce({ item: { statusId: 'first', expiresAtMs: Date.now() + 1000 } });
    await mount(); await imageReady(); await step(1000);
    expect(renderer.root.findAllByProps({ testID: 'status-image' })).toHaveLength(0);
  });
  it('ignores callbacks from an earlier attempt after retrying the same image', async () => {
    await mount(); const oldLoad = byId('status-image').props.onLoad;
    await act(async () => byId('status-image').props.onError());
    const retry = renderer.root.findAll(node => String(node.type) === 'Pressable' && node.findAll(child => String(child.type) === 'Text' && child.children.includes('common.retry')).length > 0)[0];
    await act(async () => retry.props.onPress());
    await act(async () => oldLoad()); await step(6000);
    expect(mock.mark).not.toHaveBeenCalled(); expect(byId('status-image').props.source.uri).toContain('first');
    await imageReady(); expect(mock.mark).toHaveBeenCalledWith('first');
  });
  it('waits for each image, clears the previous native image and ignores old load callbacks', async () => {
    await mount(); const oldLoad = byId('status-image').props.onLoad; await step(10_000);
    expect(mock.mark).not.toHaveBeenCalled(); expect(byId('status-image').props.source.uri).toContain('first');
    await imageReady(); expect(mock.mark).toHaveBeenCalledWith('first'); await step(5_000);
    expect(byId('status-image').props.source.uri).toContain('second'); expect(mock.mark).not.toHaveBeenCalledWith('second');
    await act(async () => { oldLoad(); }); await step(8_000); expect(mock.nav.goBack).not.toHaveBeenCalled();
    await imageReady(); await step(5_000); expect(mock.nav.goBack).toHaveBeenCalledOnce();
  });
  it('holds an image without consuming its remaining duration or advancing on release', async () => {
    await mount(); await imageReady(); await step(1000);
    await act(async () => { byId('status-next').props.onPressIn(); byId('status-next').props.onLongPress(); }); await step(9000);
    expect(byId('status-image').props.source.uri).toContain('first');
    await act(async () => { byId('status-next').props.onPressOut(); byId('status-next').props.onPress(); }); await step(3999);
    expect(byId('status-image').props.source.uri).toContain('first'); await step(1); expect(byId('status-image').props.source.uri).toContain('second');
  });
  it('pauses the native video on hold and background and ignores finished events from the old item', async () => {
    await mount([item('first', 'video'), item('second', 'video')]);
    const oldStatus = byId('status-video').props.onPlaybackStatusUpdate;
    await act(async () => byId('status-video').props.onReadyForDisplay());
    await act(async () => byId('status-next').props.onPressIn()); expect(byId('status-video').props.shouldPlay).toBe(false);
    await act(async () => byId('status-next').props.onPressOut()); expect(byId('status-video').props.shouldPlay).toBe(true);
    await act(async () => mock.appListener?.('background')); expect(renderer.root.findAllByProps({ testID: 'status-video' })).toHaveLength(0);
    await act(async () => mock.appListener?.('active')); await tapNext();
    await act(async () => oldStatus({ isLoaded: true, durationMillis: 1000, positionMillis: 1000, didJustFinish: true }));
    expect(mock.nav.goBack).not.toHaveBeenCalled(); expect(byId('status-video').props.source.uri).toContain('second');
  });
  it('opens the owner viewer list and sends a private reply through the guarded callable', async () => {
    await mount([item('first', 'text')], { isMine: true });
    const viewerButton = renderer.root.findByProps({ accessibilityLabel: 'Who viewed your story' });
    await act(async () => viewerButton.props.onPress()); expect(mock.list).toHaveBeenCalledWith('first', undefined);
    await act(async () => renderer.unmount());
    await mount([item('first', 'text')]); mock.reply.mockResolvedValue({ conversationId: 'dm', messageId: 'message' });
    await act(async () => byId('status-reply').props.onChangeText('A private reply'));
    await act(async () => renderer.root.findByProps({ accessibilityLabel: 'common.send' }).props.onPress());
    expect(mock.reply).toHaveBeenCalledWith('first', 'A private reply', expect.stringMatching(/^reply_/));
    expect(mock.nav.replace).toHaveBeenCalledWith('Conversation', { id: 'dm', title: 'Author' });
  });
});

