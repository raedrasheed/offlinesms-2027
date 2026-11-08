import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mock = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), alert: vi.fn(), remote: null as null | ((rows: any[]) => void), listeners: new Set<(id: string, uid: string) => void>() }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image', Modal: 'Modal',
  SectionList: (props: any) => createElement('SectionList', props, props.ListHeaderComponent, ...props.sections.flatMap((section: any) => section.data.map((item: any) => props.renderItem({ item })))),
  StyleSheet: { create: (value: unknown) => value }, Alert: { alert: mock.alert }, Share: {}, Clipboard: {},
}));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), onSnapshot: (_ref: any, next: (snapshot: any) => void) => { next({ exists: () => true, data: () => ({ type: 'group', name: 'Group', status: 'active' }) }); return () => {}; } }));
vi.mock('../src/lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'owner' } } }));
vi.mock('../src/lib/conversations', () => ({
  subscribeMembers: (_id: string, next: (rows: any[]) => void) => { next([{ uid: 'owner', role: 'owner' }]); return () => {}; },
  subscribeExternalMembers: (_id: string, next: (rows: any[]) => void) => { mock.remote = next; next([]); return () => {}; },
  subscribeInviteSettings: (_id: string, next: (value: any) => void) => { next(null); return () => {}; },
  subscribePendingJoinRequests: (_id: string, next: (value: any) => void) => { next([]); return () => {}; },
  groupErrorCopy: () => 'Could not complete',
}));
vi.mock('../src/localdb', () => ({
  getCurrentUid: () => 'owner', queueAddExternalContactToGroup: mock.add, queueRemoveExternalContactFromGroup: vi.fn(),
  externalMembersRepo: { listExternalMembers: mock.list },
  onExternalMembersChanged: (listener: (id: string, uid: string) => void) => { mock.listeners.add(listener); return () => { mock.listeners.delete(listener); }; },
}));
vi.mock('../src/config/features', () => ({ LOCAL_FIRST_CONVERSATION_ENABLED: true }));
vi.mock('../src/lib/phone', () => ({ maskPhone: () => '•••4567' }));
vi.mock('../src/lib/invite', () => ({ inviteUrl: () => '' }));
vi.mock('../src/lib/userProfiles', () => ({ useDisplayNames: () => (uid: string) => uid }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../src/theme', () => ({ colors: {}, radius: {} }));
vi.mock('../src/components/RegisteredBadge', () => ({ RegisteredBadge: 'RegisteredBadge' }));
vi.mock('../src/components/state', () => ({ LoadingState: 'LoadingState', PermissionState: 'PermissionState' }));
import GroupInfo from '../src/screens/GroupInfo';
let renderer: ReactTestRenderer | undefined;
const pending = { contactId: '972591234567', displayName: 'Phone', phoneE164: '+972591234567', normalizedPhone: '972591234567', isRegistered: false, linkedUid: null, pending: true, syncState: 'pending' };
const texts = () => renderer!.root.findAllByType('Text' as any).flatMap(node => node.children).filter(value => typeof value === 'string').join(' ');
async function mount() { await act(async () => { renderer = create(createElement(GroupInfo, { route: { params: { id: 'g' } }, navigation: { navigate: vi.fn() } })); }); }
async function emit(id = 'g', uid = 'owner') { await act(async () => { mock.listeners.forEach(listener => listener(id, uid)); }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.list.mockResolvedValue([pending]); mock.add.mockResolvedValue({ ok: true }); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; vi.unstubAllGlobals(); });
describe('phone contact readiness in a group', () => {
  it('shows pending instead of SMS-ready, and retries the exact group and phone', async () => {
    await mount(); expect(texts()).toContain('phoneChat.syncPending'); expect(texts()).toContain('phoneChat.syncHint');
    expect(texts()).not.toContain('SMS only');
    const stopPropagation = vi.fn();
    await act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'phoneChat.retrySync' }).props.onPress({ stopPropagation }); });
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(mock.add).toHaveBeenCalledWith({ conversationId: 'g', displayName: 'Phone', phoneE164: pending.phoneE164 });
  });
  it('refreshes a failed job from the worker event, but ignores another account’s event', async () => {
    await mount(); const calls = mock.list.mock.calls.length;
    await emit('g', 'other'); expect(mock.list).toHaveBeenCalledTimes(calls);
    mock.list.mockResolvedValue([{ ...pending, syncState: 'failed' }]); await emit();
    expect(texts()).toContain('phoneChat.syncFailed');
    mock.add.mockResolvedValueOnce({ ok: false, reason: 'not-initialised' });
    await act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'phoneChat.retrySync' }).props.onPress({ stopPropagation: () => {} }); });
    expect(mock.alert).toHaveBeenCalledWith('phoneChat.syncFailed', 'Could not complete');
  });
  it('replaces the optimistic row with one canonical remote row after sync', async () => {
    await mount();
    await act(async () => { mock.remote!([{ ...pending, pending: undefined, syncState: undefined }]); });
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'phoneChat.retrySync' })).toHaveLength(0);
    expect(texts()).toContain('SMS only');
    expect(renderer!.root.findAllByType('Text' as any).filter(node => node.children.includes('Phone'))).toHaveLength(1);
  });
});
