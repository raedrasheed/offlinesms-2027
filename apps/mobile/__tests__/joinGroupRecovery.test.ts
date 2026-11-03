import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { lightSemantic } from '../../../packages/design-tokens/src/semantic';
const mock = vi.hoisted(() => ({ preview: vi.fn(), join: vi.fn(), cancel: vi.fn(), profile: vi.fn(), focus: true,
  offline: false, auth: { currentUser: { uid: 'me' } }, nav: { navigate: vi.fn(), reset: vi.fn(), goBack: vi.fn() } }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: (s: unknown) => s } }));
vi.mock('@react-navigation/native', async () => { const { useEffect } = await import('react'); return { useFocusEffect: (callback: () => unknown) => useEffect(() => mock.focus ? callback() as (() => void) : undefined, [callback, mock.focus]) }; });
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, options: any) => options?.defaultValue ?? _key }) }));
vi.mock('../src/lib/conversations', () => ({ resolveGroupInviteLink: mock.preview, joinGroupByInviteLink: mock.join, cancelMyJoinRequest: mock.cancel }));
vi.mock('../src/lib/firebase', () => ({ auth: mock.auth, db: {} }));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDocFromServer: mock.profile }));
vi.mock('../src/context/OfflineContext', () => ({ useOffline: () => ({ isOffline: mock.offline }) }));
vi.mock('../src/context/ThemeContext', () => ({ useTheme: () => ({ colors: lightSemantic.color }) }));
import JoinGroup from '../src/screens/JoinGroup';
let renderer: ReactTestRenderer;
const initial = { conversationId: 'group-a', groupName: 'Study group', groupPhotoURL: null, memberCount: 3, joinMode: 'open', isMember: false, hasPendingRequest: false, status: 'can_join' };
const props = { route: { params: { code: 'ABCDEFGH12345678' } }, navigation: mock.nav };
const nodes = (type: string) => renderer.root.findAll(node => node.type === type);
const button = (label: string) => nodes('Pressable').find(node => node.findAll(child => String(child.type) === 'Text' && child.children.includes(label)).length);
async function mount() { await act(async () => { renderer = create(createElement(JoinGroup, props)); }); }
async function tap(label: string) { await act(async () => { await button(label)!.props.onPress(); }); }
async function focus(value: boolean) { mock.focus = value; await act(async () => { renderer.update(createElement(JoinGroup, { ...props })); }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.focus = true; mock.offline = false; mock.preview.mockResolvedValue({ ...initial }); mock.profile.mockResolvedValue({ data: () => ({ username: 'raed' }) }); mock.join.mockResolvedValue({ status: 'joined', conversationId: 'group-a' }); });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });
describe('group invite username recovery', () => {
  it('explains a missing username, then revalidates and joins the same invitation after profile save', async () => {
    mock.profile.mockResolvedValue({ data: () => ({}) }); await mount();
    expect(mock.join).not.toHaveBeenCalled(); expect(button('Set username and continue')).toBeTruthy();
    await tap('Set username and continue'); expect(mock.nav.navigate).toHaveBeenCalledWith('EditProfile', { returnToInvite: true });
    await focus(false); mock.profile.mockResolvedValue({ data: () => ({ username: 'raed' }) }); await focus(true);
    expect(mock.preview).toHaveBeenCalledTimes(2); expect(mock.join).toHaveBeenCalledTimes(1); expect(mock.join).toHaveBeenCalledWith('ABCDEFGH12345678');
    expect(mock.nav.reset).toHaveBeenCalledWith({ index: 1, routes: [{ name: 'Tabs' }, { name: 'Conversation', params: { id: 'group-a' } }] });
  });
  it('does not join when profile editing is cancelled without setting a username', async () => {
    mock.profile.mockResolvedValue({ data: () => ({}) }); await mount(); await tap('Set username and continue'); await focus(false); await focus(true);
    expect(mock.join).not.toHaveBeenCalled(); expect(button('Set username and continue')).toBeTruthy();
  });
  it('rechecks revoked invitations on return and never attempts joining', async () => {
    mock.profile.mockResolvedValue({ data: () => ({}) }); await mount(); await tap('Set username and continue'); await focus(false);
    mock.profile.mockResolvedValue({ data: () => ({ username: 'raed' }) }); mock.preview.mockResolvedValue({ ...initial, status: 'disabled' }); await focus(true);
    expect(mock.join).not.toHaveBeenCalled(); expect(nodes('Text').some(node => String(node.children).includes('disabled'))).toBe(true);
  });
  it('does not demand profile editing for an existing member', async () => {
    mock.profile.mockResolvedValue({ data: () => ({}) }); mock.preview.mockResolvedValue({ ...initial, status: 'already_member', isMember: true }); await mount();
    expect(button('Set username and continue')).toBeUndefined(); await tap('Open group'); expect(mock.nav.reset).toHaveBeenCalledOnce();
  });
  it.each([
    [{ code: 'functions/not-found' }, 'invalid or has expired'],
    [{ code: 'functions/permission-denied' }, 'do not have permission'],
    [{ code: 'functions/failed-precondition', message: 'group-full' }, 'group is full'],
  ])('shows a specific non-retrying error for %j', async (error, text) => {
    await mount(); mock.join.mockRejectedValue(error); await tap('Join group');
    expect(nodes('Text').some(node => String(node.children).includes(text))).toBe(true); expect(button('Try again')).toBeUndefined();
  });
  it('recovers server-side username-required rather than replacing it with a generic failure', async () => {
    await mount(); mock.join.mockRejectedValue({ code: 'functions/failed-precondition', details: { reason: 'username-required' } }); await tap('Join group');
    expect(button('Set username and continue')).toBeTruthy();
  });
});
