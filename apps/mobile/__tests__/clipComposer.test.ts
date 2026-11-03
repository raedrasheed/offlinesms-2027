import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ClipDraft } from '../src/lib/clipDrafts';
const mock = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), start: vi.fn(), config: vi.fn(), accept: vi.fn(), info: vi.fn(), alert: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), nav: { addListener: vi.fn(() => () => {}), navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn() } }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Switch: 'Switch', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1, absoluteFill: {} }, Alert: { alert: mock.alert } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('expo-av', () => ({ Audio: {}, Video: 'Video', ResizeMode: { CONTAIN: 'contain' } }));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-file-system', () => ({ getInfoAsync: mock.info }));
vi.mock('@react-native-community/netinfo', () => ({ default: { addEventListener: () => () => {} } }));
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: { uid: 'me' } } }));
vi.mock('../src/lib/clipsCopy', () => ({ useClipsCopy: () => ({ c: (en: string) => en, rtl: false }) }));
vi.mock('../src/lib/clips', () => ({ getClipsConfig: mock.config, acceptClipsTerms: mock.accept }));
vi.mock('../src/lib/clipDrafts', () => ({ createClipDraft: vi.fn(), getClipDraft: mock.get, saveClipDraft: mock.save }));
vi.mock('../src/lib/clipUploads', () => ({ startClipUpload: mock.start }));
vi.mock('../src/hooks/useClipDestinations', () => ({ useClipDestinations: () => ({ rows: [], loading: false }) }));
import ClipComposer from '../src/screens/clips/ClipComposer';
const draft: ClipDraft = { id: 'draft1', uid: 'me', localUri: 'file:///private/draft.mp4', mimeType: 'video/mp4', sizeBytes: 5000, durationMs: 30_000, caption: 'A moment', audience: 'public', groupId: null, allowComments: true, allowDownload: false, trimStartMs: 0, trimEndMs: 30_000, overlayText: '', mute: false, coverTimeMs: 0, createdAtMs: 1, updatedAtMs: 1, status: 'draft' };
let renderer: ReactTestRenderer;
const nodes = (type: string) => renderer.root.findAll(node => String(node.type) === type);
const button = (value: string) => nodes('Pressable').find(node => node.findAll(child => String(child.type) === 'Text' && child.children.includes(value)).length > 0)!;
async function mount() { await act(async () => { renderer = create(createElement(ClipComposer, { route: { params: { draftId: 'draft1' } }, navigation: mock.nav })); }); }
async function tap(value: string) { await act(async () => { button(value).props.onPress(); }); }
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.get.mockResolvedValue({ ...draft }); mock.save.mockImplementation(async value => value); mock.info.mockResolvedValue({ exists: true }); mock.config.mockResolvedValue({ config: { enabled: true, maxDurationSeconds: 60, maxUploadMB: 80, termsVersion: 'v1' }, termsAccepted: true }); });
afterEach(async () => { if (renderer) await act(async () => { renderer.unmount(); }); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Clip composer durable uploads', () => {
  it('requires an explicit audience and terms acceptance before upload', async () => {
    mock.get.mockResolvedValue({ ...draft, audience: null });
    mock.config.mockResolvedValue({ config: { enabled: true, maxDurationSeconds: 60, maxUploadMB: 80, termsVersion: 'v2' }, termsAccepted: false });
    await mount(); expect(button('Publish').props.disabled).toBe(true);
    await tap('Public'); expect(button('Publish').props.disabled).toBe(true);
    const checkbox = nodes('Pressable').find(node => node.props.accessibilityRole === 'checkbox')!;
    await act(async () => { checkbox.props.onPress(); }); expect(button('Publish').props.disabled).toBe(false);
    expect(mock.start).not.toHaveBeenCalled();
  });
  it('shows pause/resume and preserves retry after cancellation', async () => {
    let reject!: (reason: Error) => void, progress!: (event: { progress: number; state: string }) => void;
    mock.start.mockImplementation(async (_draft, callbacks) => { progress = callbacks.onProgress; return { pause: () => { mock.pause(); progress({ progress: .4, state: 'paused' }); }, resume: () => { mock.resume(); progress({ progress: .4, state: 'running' }); }, cancel: () => { mock.cancel(); reject(new Error('clip-upload-cancelled')); }, done: new Promise((_resolve, fail) => { reject = fail; }) }; });
    await mount(); await tap('Publish');
    await tap('Pause'); expect(mock.pause).toHaveBeenCalledOnce(); expect(button('Resume')).toBeTruthy();
    await tap('Resume'); expect(mock.resume).toHaveBeenCalledOnce();
    await tap('Cancel upload'); expect(mock.cancel).toHaveBeenCalledOnce(); expect(button('Publish')).toBeTruthy();
    expect(nodes('Text').some(node => node.children.includes('Upload stopped. The draft is kept for retry.'))).toBe(true);
  });
  it('does not overwrite upload metadata with a stale autosave after completion', async () => {
    const uploaded = { ...draft, clipId: 'published1', status: 'processing' as const };
    mock.get.mockResolvedValueOnce({ ...draft }).mockResolvedValue(uploaded);
    mock.start.mockResolvedValue({ pause: mock.pause, resume: mock.resume, cancel: mock.cancel, done: Promise.resolve({ clipId: 'published1', status: 'processing' }) });
    await mount(); await tap('Publish');
    const writes = mock.save.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mock.save).toHaveBeenCalledTimes(writes);
    await tap('View my clip'); expect(mock.nav.replace).toHaveBeenCalledWith('ClipViewer', { clipId: 'published1' });
  });
  it('honors cancellation while the upload handle is still initializing', async () => {
    let initialize!: (handle: unknown) => void, reject!: (error: Error) => void;
    mock.start.mockImplementation(() => new Promise(resolve => { initialize = resolve; }));
    await mount(); await tap('Publish'); await tap('Cancel upload');
    await act(async () => {
      initialize({ pause: mock.pause, resume: mock.resume, cancel: () => { mock.cancel(); reject(new Error('clip-upload-cancelled')); }, done: new Promise((_resolve, fail) => { reject = fail; }) });
    });
    expect(mock.cancel).toHaveBeenCalledOnce(); expect(button('Publish')).toBeTruthy();
  });
  it('reports a missing local file without allowing upload', async () => {
    mock.info.mockResolvedValue({ exists: false }); await mount();
    expect(button('Publish')).toBeUndefined();
    expect(nodes('Text').some(node => node.children.includes('This draft or its video file is no longer available.'))).toBe(true);
    expect(mock.start).not.toHaveBeenCalled();
  });
  it('clears a reused composer when starting a new draft and while switching drafts', async () => {
    await mount(); expect(button('Publish')).toBeTruthy();
    await act(async () => { renderer.update(createElement(ClipComposer, { route: { params: { draftId: undefined, draftRequestId: 'new' } }, navigation: mock.nav })); });
    expect(button('Publish')).toBeUndefined(); expect(button('Record video')).toBeTruthy();
    let resolve!: (value: ClipDraft | null) => void;
    mock.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => { renderer.update(createElement(ClipComposer, { route: { params: { draftId: 'missing', draftRequestId: 'switch' } }, navigation: mock.nav })); });
    expect(button('Publish')).toBeUndefined();
    await act(async () => { resolve(null); });
    expect(button('Publish')).toBeUndefined(); expect(mock.start).not.toHaveBeenCalled();
  });
  it('shows the actual permission category and keeps the draft available to retry', async () => {
    mock.start.mockRejectedValue(Object.assign(new Error('sensitive raw URL must not be shown'), { code: 'storage/unauthorized', clipUploadStage: 'upload' }));
    await mount(); await tap('Publish');
    expect(nodes('Text').some(node => node.children.includes('The upload was denied. Your draft is kept; contact support if this continues.'))).toBe(true);
    expect(JSON.stringify(renderer.toJSON())).not.toContain('sensitive raw URL');
    expect(button('Publish').props.disabled).toBe(false);
  });
  it('reloads changed terms and requires fresh consent before retrying', async () => {
    mock.start.mockRejectedValue(Object.assign(new Error('clips-terms-required'), { code: 'functions/failed-precondition' }));
    await mount();
    mock.config.mockResolvedValue({ config: { enabled: true, maxDurationSeconds: 60, maxUploadMB: 80, termsVersion: 'v2' }, termsAccepted: false });
    await tap('Publish');
    expect(mock.config).toHaveBeenCalledTimes(2);
    expect(nodes('Text').some(node => node.children.includes('The community terms changed. Read and accept the updated terms before publishing.'))).toBe(true);
    expect(button('Publish').props.disabled).toBe(true);
    const checkbox = nodes('Pressable').find(node => node.props.accessibilityRole === 'checkbox')!;
    expect(checkbox.props.accessibilityState.checked).toBe(false);
    await act(async () => { checkbox.props.onPress(); });
    mock.start.mockRejectedValue(new Error('clip-upload-cancelled'));
    await tap('Publish');
    expect(mock.accept).toHaveBeenCalledWith('v2');
  });
  it('reports unconfirmed publication without incorrectly claiming upload failed', async () => {
    mock.start.mockImplementation(async (_draft, callbacks) => {
      callbacks.onProgress({ progress: 1, state: 'processing' });
      return { pause: mock.pause, resume: mock.resume, cancel: mock.cancel,
        done: Promise.reject(Object.assign(new Error('deadline'), { code: 'functions/deadline-exceeded', clipUploadStage: 'publish' })) };
    });
    await mount(); await tap('Publish');
    expect(nodes('Text').some(node => node.children.includes('Video upload completed, but publication was not confirmed. Retry this draft to check its status.'))).toBe(true);
    expect(button('Publish').props.disabled).toBe(false);
    expect(mock.alert).not.toHaveBeenCalled();
  });
});
