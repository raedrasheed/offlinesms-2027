import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ClipItem } from '../src/lib/clips';
const mock = vi.hoisted(() => ({ auth: { currentUser: { uid: 'me' } }, playback: vi.fn(), download: vi.fn(), removeFile: vi.fn(), shareFile: vi.fn(), deleteClip: vi.fn(), alert: vi.fn() }));
vi.mock('react-native', () => ({ Modal: 'Modal', View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Switch: 'Switch', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }, Alert: { alert: mock.alert } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('expo-file-system', () => ({ cacheDirectory: 'file:///cache/', makeDirectoryAsync: vi.fn(), downloadAsync: mock.download, deleteAsync: mock.removeFile }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: mock.shareFile }));
vi.mock('../src/lib/firebase', () => ({ auth: mock.auth }));
vi.mock('../src/lib/blocks', () => ({ blockUser: vi.fn() }));
vi.mock('../src/lib/clipsCopy', () => ({ useClipsCopy: () => ({ c: (en: string) => en, rtl: false }) }));
vi.mock('../src/lib/clips', () => ({ getClipPlayback: mock.playback, deleteClip: mock.deleteClip, reportClip: vi.fn(), setClipInteraction: vi.fn(), updateClip: vi.fn() }));
vi.mock('../src/hooks/useClipDestinations', () => ({ useClipDestinations: () => ({ rows: [], loading: false }) }));
import ClipActionsSheet from '../src/components/clips/ClipActionsSheet';
const clip = { id: 'clip1', ownerUid: 'me', caption: 'Hello', audience: 'public', status: 'published', allowComments: true, allowDownload: true } as ClipItem;
let renderer: ReactTestRenderer;
const button = (text: string) => renderer.root.findAll(node => String(node.type) === 'Pressable').find(node => node.findAll(child => String(child.type) === 'Text' && child.children.includes(text)).length > 0);
async function mount(value = clip) { await act(async () => { renderer = create(createElement(ClipActionsSheet, { visible: true, clip: value, onClose: vi.fn() })); }); }
async function tap(text: string) { await act(async () => { button(text)!.props.onPress(); }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.auth.currentUser = { uid: 'me' }; mock.playback.mockResolvedValue({ url: 'https://example.com/short-lived-lease' }); mock.download.mockResolvedValue({ status: 200, uri: 'file:///cache/clip-downloads/me/clip1.mp4' }); mock.removeFile.mockResolvedValue(undefined); mock.shareFile.mockResolvedValue(undefined); });
afterEach(async () => { if (renderer) await act(async () => { renderer.unmount(); }); vi.unstubAllGlobals(); });
describe('Clip actions privacy', () => {
  it('does not offer downloads when the creator disabled them', async () => { await mount({ ...clip, allowDownload: false }); expect(button('Download / save video')).toBeUndefined(); });
  it('uses an authorized download lease and removes its temporary file', async () => { await mount(); await tap('Download / save video'); expect(mock.playback).toHaveBeenCalledWith({ clipId: 'clip1', quality: 'standard', download: true }); expect(mock.shareFile).toHaveBeenCalledOnce(); expect(mock.removeFile).toHaveBeenCalledWith('file:///cache/clip-downloads/me/clip1.mp4', { idempotent: true }); });
  it('cleans partial files when a download fails', async () => { mock.download.mockRejectedValueOnce(new Error('network')); await mount(); await tap('Download / save video'); expect(mock.shareFile).not.toHaveBeenCalled(); expect(mock.removeFile).toHaveBeenCalledOnce(); });
  it('does not open a downloaded private file after the account changes', async () => {
    let resolve!: (value: unknown) => void;
    mock.download.mockReturnValue(new Promise(done => { resolve = done; }));
    await mount(); await tap('Download / save video');
    mock.auth.currentUser = { uid: 'another' };
    await act(async () => { resolve({ status: 200, uri: 'file:///cache/clip-downloads/me/clip1.mp4' }); });
    expect(mock.shareFile).not.toHaveBeenCalled(); expect(mock.removeFile).toHaveBeenCalledOnce();
  });
  it('does not act on a delete confirmation belonging to a replaced clip', async () => {
    await mount(); await tap('Delete clip');
    const confirm = mock.alert.mock.calls[0][2].find((button: { text: string }) => button.text === 'Delete');
    await act(async () => { renderer.update(createElement(ClipActionsSheet, { visible: true, clip: { ...clip, id: 'new' }, onClose: vi.fn() })); });
    await act(async () => { confirm.onPress(); });
    expect(mock.deleteClip).not.toHaveBeenCalled();
  });
});
