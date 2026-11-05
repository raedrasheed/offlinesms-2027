import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const api = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } as any }, authNext: null as any,
  profiles: new Map<string, (value: any) => void>(), profileErrors: new Map<string, () => void>(),
  push: vi.fn(), clipDrain: vi.fn(), inviteDrain: vi.fn(), clipConfig: null as any, inviteConfig: null as any,
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: any, next: any) => { api.authNext = next; next(api.auth.currentUser); return () => {}; } }));
vi.mock('firebase/firestore', () => ({ doc: (_db: any, _collection: string, uid: string) => uid,
  onSnapshot: (uid: string, next: any, error: any) => { api.profiles.set(uid, next); api.profileErrors.set(uid, error); return () => {}; },
}));
vi.mock('../src/lib/firebase', () => ({ auth: api.auth, db: {} }));
vi.mock('@react-navigation/native', () => ({
  NavigationContainer: (props: any) => createElement('NavigationContainer', props, props.children),
  createNavigationContainerRef: () => ({ current: null, isReady: () => true, navigate: vi.fn() }),
}));
vi.mock('@react-navigation/native-stack', () => ({ createNativeStackNavigator: () => ({
  Navigator: (props: any) => createElement('Navigator', props, props.children), Screen: (props: any) => createElement('Route', { name: props.name }),
}) }));
vi.mock('@react-navigation/bottom-tabs', () => ({ BottomTabBar: 'BottomTabBar', createBottomTabNavigator: () => ({ Navigator: 'TabNavigator', Screen: 'TabRoute' }) }));
vi.mock('expo-linking', () => ({ getInitialURL: async () => null, addEventListener: () => ({ remove: () => {} }) }));
vi.mock('expo-notifications', () => ({ addNotificationReceivedListener: () => ({ remove: () => {} }), addNotificationResponseReceivedListener: () => ({ remove: () => {} }), getLastNotificationResponseAsync: async () => null }));
vi.mock('react-native', () => ({ Linking: { openURL: vi.fn() } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaProvider: (p: any) => p.children, useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('react-native-keyboard-controller', () => ({ KeyboardProvider: (p: any) => p.children }));
vi.mock('expo-share-intent', () => ({ ShareIntentProvider: (p: any) => p.children, useShareIntentContext: () => ({ hasShareIntent: false }) }));
vi.mock('../src/context/ThemeContext', () => ({ ThemeProvider: (p: any) => createElement('Theme', p, p.children), useTheme: () => ({ colors: {} }) }));
vi.mock('../src/context/OfflineContext', () => ({ OfflineProvider: (p: any) => p.children }));
vi.mock('../src/components/ErrorBoundary', () => ({ ErrorBoundary: (p: any) => p.children }));
vi.mock('../src/hooks/useLocalPersistence', () => ({ useChatListPersistence: () => {} }));
vi.mock('../src/hooks/usePresence', () => ({ usePresence: () => {} }));
vi.mock('../src/lib/unreadStore', () => ({ useUnreadTotal: () => 0 }));
vi.mock('../src/lib/clipsCopy', () => ({ useClipsCopy: () => ({ c: (en: string) => en }) }));
vi.mock('../src/lib/deepLinks', () => ({ inviteCodeFromUrl: () => null, takePendingInvite: vi.fn(), setPendingInvite: vi.fn(), takePendingClip: vi.fn(), setPendingClip: vi.fn() }));
vi.mock('../src/lib/clipReference', () => ({ clipIdFromUrl: () => null }));
vi.mock('../src/lib/pendingClipNavigation', () => ({ createPendingClipNavigation: (config: any) => { api.clipConfig = config; return { drain: api.clipDrain, receive: vi.fn() }; } }));
vi.mock('../src/lib/pendingInviteNavigation', () => ({ createPendingInviteNavigation: (config: any) => { api.inviteConfig = config; return { drain: api.inviteDrain, receive: vi.fn() }; } }));
vi.mock('../src/lib/pushTapQueue', () => ({ createPushTapQueue: () => ({ drain: () => {}, hasPending: () => false, receive: () => {} }) }));
vi.mock('../src/lib/notifications', () => ({ installForegroundHandler: () => {}, registerForPush: api.push, dismissNotificationById: vi.fn(), routeFromNotification: () => null }));
vi.mock('../src/lib/appCheck', () => ({ initAppCheck: () => {} }));
vi.mock('../src/lib/pushRouting', () => ({ dispatchForRoute: () => ({ kind: 'none' }), pushTarget: () => null }));
vi.mock('../src/lib/perf', () => ({ perfMark: () => {}, perfBegin: () => {}, perfNow: () => 0 }));
vi.mock('../src/localdb', () => ({ notificationTargets: { request: vi.fn() }, pullConversationNow: async () => {}, openLocalDb: async () => {} }));
vi.mock('../src/i18n', () => ({}));

let App: typeof import('../App').default;
let renderer: ReactTestRenderer | undefined;
const screens = [
  "../src/screens/Splash",
  "../src/screens/Welcome",
  "../src/screens/PhoneEntry",
  "../src/screens/Otp",
  "../src/screens/EmailLogin",
  "../src/screens/EmailEntry",
  "../src/screens/EmailOtp",
  "../src/screens/CreatePin",
  "../src/screens/LinkPhone",
  "../src/screens/ChangeEmail",
  "../src/screens/Permissions",
  "../src/screens/FindFriends",
  "../src/screens/IncomingCall",
  "../src/screens/ChatsList",
  "../src/screens/Conversation",
  "../src/screens/NewChat",
  "../src/screens/NewChatMenu",
  "../src/screens/NewGroup",
  "../src/screens/GroupCreateInfo",
  "../src/screens/GroupInvitations",
  "../src/screens/GroupInfo",
  "../src/screens/EditGroup",
  "../src/screens/AddMembers",
  "../src/screens/JoinRequests",
  "../src/screens/ForwardPicker",
  "../src/screens/MessageInfo",
  "../src/screens/TransactionDetail",
  "../src/screens/RequestPoints",
  "../src/screens/MyPointsRequests",
  "../src/screens/TransferPoints",
  "../src/screens/ChatWallpaper",
  "../src/screens/SmsBatchReport",
  "../src/screens/Status",
  "../src/screens/StatusComposer",
  "../src/screens/StatusViewer",
  "../src/screens/clips/ClipsFeed",
  "../src/screens/clips/ClipViewer",
  "../src/screens/clips/ClipProfile",
  "../src/screens/clips/ClipPreferences",
  "../src/screens/clips/ClipComposer",
  "../src/screens/clips/ClipDrafts",
  "../src/screens/clips/ClipFollowRequests",
  "../src/screens/SocialActivity",
  "../src/screens/Settings",
  "../src/screens/Points",
  "../src/screens/Privacy",
  "../src/screens/Devices",
  "../src/screens/SmsEscalation",
  "../src/screens/SupportTicket",
  "../src/screens/EditProfile",
  "../src/screens/ImagePreviewScreen",
  "../src/screens/ImageViewerScreen",
  "../src/screens/JoinGroup",
  "../src/screens/NotificationSettings",
  "../src/screens/ShareToChat"
];
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.auth.currentUser = { uid: 'a' }; api.profiles.clear(); api.profileErrors.clear();
  api.push.mockResolvedValue(undefined); api.clipDrain.mockResolvedValue(undefined); api.inviteDrain.mockResolvedValue(undefined);
  if (!App) {
    for (const path of screens) vi.doMock(path, () => ({ default: () => null }));
    App = (await import('../App')).default;
  }
});
afterEach(async () => { if (renderer) await act(async () => { renderer!.unmount(); }); renderer = undefined; vi.unstubAllGlobals(); });
const routes = () => renderer!.root.findAllByType('Route' as any).map(node => node.props.name);
async function mount() { await act(async () => { renderer = create(createElement(App)); }); }
async function profile(data: Record<string, unknown> | null, uid = 'a') { await act(async () => { api.profiles.get(uid)!({ data: () => data }); }); }
describe('startup without profile onboarding', () => {
  it('opens the session immediately while the user profile has not loaded', async () => {
    await mount(); expect(routes()).toContain('Tabs'); expect(routes()).toContain('EditProfile');
    expect(routes()).not.toContain('ProfileCompletion');
    expect(api.push).toHaveBeenCalledWith('a'); expect(api.clipDrain).toHaveBeenCalled(); expect(api.inviteDrain).toHaveBeenCalled();
    expect(api.clipConfig.account()).toBe('a'); expect(api.inviteConfig.account()).toBe('a');
  });
  it('keeps the session open for incomplete, missing and completed profile snapshots', async () => {
    await mount();
    for (const data of [{ profileCompleted: false }, null, { profileCompleted: true }, { profileCompleted: false }]) {
      await profile(data); expect(routes()).toContain('Tabs'); expect(routes()).not.toContain('ProfileCompletion');
    }
  });
  it('keeps the session usable when profile preferences cannot load', async () => {
    await mount(); await act(async () => { api.profileErrors.get('a')!(); });
    expect(routes()).toContain('Tabs'); expect(routes()).not.toContain('ProfileCompletion');
  });
  it('preserves account-bound optional themes and ignores a previous account’s callback', async () => {
    await mount(); await profile({ preferredTheme: 'dark', profileCompleted: false });
    expect(renderer!.root.findByType('Theme' as any).props.userPreference).toBe('dark');
    api.auth.currentUser = { uid: 'b' };
    await act(async () => { api.authNext(api.auth.currentUser); });
    expect(renderer!.root.findByType('Theme' as any).props.userPreference).toBeNull();
    await profile({ preferredTheme: 'light' }, 'a');
    expect(renderer!.root.findByType('Theme' as any).props.userPreference).toBeNull();
    expect(api.inviteConfig.account()).toBe('b');
    await profile({ preferredTheme: 'system' }, 'b');
    expect(renderer!.root.findByType('Theme' as any).props.userPreference).toBe('system'); expect(routes()).toContain('Tabs');
  });
  it('shows sign-in when logged out and goes directly into the session after sign-in', async () => {
    api.auth.currentUser = null; await mount(); expect(routes()).toContain('Welcome'); expect(routes()).not.toContain('Tabs');
    expect(api.push).not.toHaveBeenCalled();
    api.auth.currentUser = { uid: 'new-account' }; await act(async () => { api.authNext(api.auth.currentUser); });
    expect(routes()).toContain('Tabs'); expect(routes()).not.toContain('ProfileCompletion');
  });
});
