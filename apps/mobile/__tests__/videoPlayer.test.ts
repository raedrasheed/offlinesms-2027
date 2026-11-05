import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mock = vi.hoisted(() => ({ command: vi.fn(), error: vi.fn(), ready: vi.fn(), listeners: new Set<(value: string) => void>() }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'Spinner',
  StyleSheet: { create: (value: unknown) => value, absoluteFillObject: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 } },
  AppState: { currentState: 'active', addEventListener: (_event: string, listener: (value: string) => void) => {
    mock.listeners.add(listener); return { remove: () => mock.listeners.delete(listener) };
  } },
}));
vi.mock('expo-av', () => ({ Video: 'NativeVideo', ResizeMode: { CONTAIN: 'contain' } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import { VideoPlayer, videoTime } from '../src/components/VideoPlayer';

let renderer: ReactTestRenderer | undefined;
let props: Parameters<typeof VideoPlayer>[0];
const native = () => renderer!.root.findByType('NativeVideo' as any);
const bar = () => renderer!.root.findByProps({ testID: 'video-seek-bar' });
const toggle = () => renderer!.root.findByProps({ testID: 'video-play-toggle' });
const event = (locationX: number) => ({ nativeEvent: { locationX } });
const value = (extra = {}) => ({ isLoaded: true, positionMillis: 0, durationMillis: 10_000, isPlaying: false, isBuffering: false, didJustFinish: false, ...extra });
async function mount(extra = {}) {
  props = { uri: 'file:///video.mp4', onError: mock.error, onReady: mock.ready, ...extra };
  await act(async () => { renderer = create(createElement(VideoPlayer, props), { createNodeMock: node => node.type === 'NativeVideo' ? { setStatusAsync: mock.command } : null }); });
}
async function update(extra = {}) { props = { ...props, ...extra }; await act(async () => renderer!.update(createElement(VideoPlayer, props))); }
async function load(extra = {}) { await act(async () => native().props.onLoad(value(extra))); }
async function status(extra = {}) { await act(async () => native().props.onPlaybackStatusUpdate(value(extra))); }
async function press() { await act(async () => toggle().props.onPress()); }
async function layout() { await act(async () => bar().props.onLayout({ nativeEvent: { layout: { width: 200 } } })); }
async function app(state: string) { await act(async () => mock.listeners.forEach(listener => listener(state))); }
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.command.mockResolvedValue(value()); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('video startup and timeline', () => {
  it('explicitly starts the loaded native player even if its first frame is stopped', async () => {
    await mount(); expect(native().props.useNativeControls).toBe(false);
    await load(); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true }); expect(mock.ready).not.toHaveBeenCalled();
    await act(async () => native().props.onReadyForDisplay({ naturalSize: { width: 1920, height: 1080 } }));
    expect(mock.ready).toHaveBeenCalledTimes(1);
    await press(); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true });
  });
  it('pauses, resumes and replays from zero while displaying native progress', async () => {
    await mount(); await load(); await status({ isPlaying: true, positionMillis: 2000 });
    expect(bar().props.accessibilityValue.now).toBe(2);
    await press(); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: false });
    await press(); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true });
    await status({ positionMillis: 10_000, didJustFinish: true });
    expect(native().props.shouldPlay).toBe(false);
    await press(); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true, positionMillis: 0, seekMillisToleranceBefore: 0, seekMillisToleranceAfter: 0 });
  });
  it('pauses during dragging, seeks only on release and resumes prior play intent', async () => {
    await mount(); await load(); await status({ isPlaying: true, positionMillis: 1000 }); await layout();
    await act(async () => bar().props.onResponderGrant(event(40)));
    expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: false });
    const calls = mock.command.mock.calls.length;
    await act(async () => bar().props.onResponderMove(event(150)));
    expect(mock.command.mock.calls.length).toBe(calls); expect(bar().props.accessibilityValue.now).toBe(7);
    await act(async () => bar().props.onResponderRelease(event(150)));
    expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true, positionMillis: 7500, seekMillisToleranceBefore: 0, seekMillisToleranceAfter: 0 });
  });
  it('keeps an explicitly paused video paused after seeking and clamps the track edges', async () => {
    await mount(); await load(); await status({ isPlaying: true }); await press(); await layout();
    await act(async () => bar().props.onResponderGrant(event(-10)));
    expect(bar().props.accessibilityValue.now).toBe(0);
    await act(async () => bar().props.onResponderRelease(event(500)));
    expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: false, positionMillis: 10_000, seekMillisToleranceBefore: 0, seekMillisToleranceAfter: 0 });
  });
  it('restores the pre-drag position when the responder is interrupted', async () => {
    await mount(); await load(); await status({ isPlaying: true, positionMillis: 3000 }); await layout();
    await act(async () => bar().props.onResponderGrant(event(180)));
    await act(async () => bar().props.onResponderTerminate());
    expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true, positionMillis: 3000, seekMillisToleranceBefore: 0, seekMillisToleranceAfter: 0 });
  });
  it('supports screen-reader seeking and safely handles unknown duration', async () => {
    await mount(); await load({ durationMillis: undefined }); await layout();
    expect(bar().props.onStartShouldSetResponder()).toBe(false);
    await status({ positionMillis: 9000 });
    await act(async () => bar().props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true, positionMillis: 10_000, seekMillisToleranceBefore: 0, seekMillisToleranceAfter: 0 });
    await act(async () => bar().props.onAccessibilityAction({ nativeEvent: { actionName: 'decrement' } }));
    expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true, positionMillis: 5000, seekMillisToleranceBefore: 0, seekMillisToleranceAfter: 0 });
    expect(videoTime(NaN)).toBe('0:00'); expect(videoTime(65_000)).toBe('1:05');
  });
  it('honors external holds, background and explicit pause across foreground resume', async () => {
    await mount(); await load(); await status({ isPlaying: true, positionMillis: 1000 });
    await update({ paused: true }); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: false });
    await update({ paused: false }); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true });
    await app('background'); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: false });
    await app('active'); expect(mock.command).toHaveBeenLastCalledWith({ shouldPlay: true });
    await press(); await app('background'); await app('active'); expect(native().props.shouldPlay).toBe(false);
  });
  it('ignores old source callbacks and rejected commands after the source changes or unmounts', async () => {
    let reject!: (error: Error) => void; mock.command.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await mount(); const old = native().props; await load();
    await update({ uri: 'https://example.test/fresh.mp4' });
    await act(async () => { old.onError(); old.onLoad(value()); reject(new Error('old')); });
    expect(mock.error).not.toHaveBeenCalled(); expect(native().props.source.uri).toBe('https://example.test/fresh.mp4');
    const later = native().props; await act(async () => renderer!.unmount()); renderer = undefined;
    await act(async () => later.onError()); expect(mock.error).not.toHaveBeenCalled(); expect(mock.listeners.size).toBe(0);
  });
  it('ignores an obsolete play failure after a newer pause command', async () => {
    let reject!: (error: Error) => void; mock.command.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await mount(); await load(); await status({ isPlaying: true, positionMillis: 1000 }); await press();
    await act(async () => reject(new Error('superseded'))); expect(mock.error).not.toHaveBeenCalled();
  });
  it('reports a rejected seek instead of hiding it behind a redundant resume command', async () => {
    await mount(); await load(); await status({ isPlaying: true, positionMillis: 1000 }); await layout();
    await act(async () => bar().props.onResponderGrant(event(40)));
    mock.command.mockImplementationOnce(() => Promise.reject(new Error('seek-failed')));
    await act(async () => bar().props.onResponderRelease(event(150)));
    expect(mock.error).toHaveBeenCalledTimes(1);
  });
  it('ends a stalled first frame after a bounded timeout and reports native failure once', async () => {
    await mount(); await load(); await act(async () => { vi.advanceTimersByTime(25_000); });
    expect(mock.error).toHaveBeenCalledTimes(1);
    await act(async () => native().props.onError()); expect(mock.error).toHaveBeenCalledTimes(1);
  });
  it('does not time out moving video or a deliberately held first frame', async () => {
    await mount({ paused: true, controls: false }); await load();
    expect(renderer!.root.findAllByProps({ testID: 'video-seek-bar' })).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(30_000); }); expect(mock.error).not.toHaveBeenCalled();
    await update({ paused: false }); await status({ isPlaying: true, positionMillis: 250 });
    await act(async () => { vi.advanceTimersByTime(30_000); }); expect(mock.error).not.toHaveBeenCalled();
  });
});
