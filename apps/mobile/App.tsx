import { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './src/lib/firebase';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { OfflineProvider } from './src/context/OfflineContext';
import { useAccountProfile } from './src/hooks/useAccountProfile';
import { ErrorState, LoadingState } from './src/components/state';
import { useTranslation } from 'react-i18next';
import './src/i18n';

import Splash from './src/screens/Splash';
import Welcome from './src/screens/Welcome';
import PhoneEntry from './src/screens/PhoneEntry';
import Otp from './src/screens/Otp';
import EmailLogin from './src/screens/EmailLogin';
import EmailEntry from './src/screens/EmailEntry';
import EmailOtp from './src/screens/EmailOtp';
import ProfileCompletion from './src/screens/ProfileCompletion';
import CreatePin from './src/screens/CreatePin';
import LinkPhone from './src/screens/LinkPhone';
import ChangeEmail from './src/screens/ChangeEmail';
import Permissions from './src/screens/Permissions';
import FindFriends from './src/screens/FindFriends';
import IncomingCall from './src/screens/IncomingCall';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useChatListPersistence } from './src/hooks/useLocalPersistence';
import { usePresence } from './src/hooks/usePresence';
import { useUnreadTotal } from './src/lib/unreadStore';
import ChatsList from './src/screens/ChatsList';
import Conversation from './src/screens/Conversation';
import NewChat from './src/screens/NewChat';
import NewChatMenu from './src/screens/NewChatMenu';
import NewGroup from './src/screens/NewGroup';
import GroupCreateInfo from './src/screens/GroupCreateInfo';
import GroupInvitations from './src/screens/GroupInvitations';
import GroupInfo from './src/screens/GroupInfo';
import EditGroup from './src/screens/EditGroup';
import AddMembers from './src/screens/AddMembers';
import JoinRequests from './src/screens/JoinRequests';
import ForwardPicker from './src/screens/ForwardPicker';
import MessageInfo from './src/screens/MessageInfo';
import TransactionDetail from './src/screens/TransactionDetail';
import RequestPoints from './src/screens/RequestPoints';
import MyPointsRequests from './src/screens/MyPointsRequests';
import TransferPoints from './src/screens/TransferPoints';
import ChatWallpaper from './src/screens/ChatWallpaper';
import SmsBatchReport from './src/screens/SmsBatchReport';
import Status from './src/screens/Status';
import StatusComposer from './src/screens/StatusComposer';
import StatusViewer from './src/screens/StatusViewer';
import ClipsFeed from './src/screens/clips/ClipsFeed';
import ClipViewer from './src/screens/clips/ClipViewer';
import ClipProfile from './src/screens/clips/ClipProfile';
import ClipPreferences from './src/screens/clips/ClipPreferences';
import ClipComposer from './src/screens/clips/ClipComposer';
import ClipDrafts from './src/screens/clips/ClipDrafts';
import ClipFollowRequests from './src/screens/clips/ClipFollowRequests';
import SocialActivity from './src/screens/SocialActivity';
import { useClipsCopy } from './src/lib/clipsCopy';
import Settings from './src/screens/Settings';
import Points from './src/screens/Points';
import Privacy from './src/screens/Privacy';
import Devices from './src/screens/Devices';
import SmsEscalation from './src/screens/SmsEscalation';
import SupportTicket from './src/screens/SupportTicket';
import EditProfile from './src/screens/EditProfile';
import ImagePreviewScreen from './src/screens/ImagePreviewScreen';
import ImageViewerScreen from './src/screens/ImageViewerScreen';
import JoinGroup from './src/screens/JoinGroup';
import NotificationSettings from './src/screens/NotificationSettings';
import { inviteCodeFromUrl, setPendingInvite, takePendingInvite, setPendingClip, takePendingClip } from './src/lib/deepLinks';
import { clipIdFromUrl } from './src/lib/clipReference';
import { createPendingClipNavigation } from './src/lib/pendingClipNavigation';
import { createPendingInviteNavigation } from './src/lib/pendingInviteNavigation';
import { createPushTapQueue } from './src/lib/pushTapQueue';
import * as Notifications from 'expo-notifications';
import { installForegroundHandler, registerForPush, routeFromNotification, dismissNotificationById } from './src/lib/notifications';
import { initAppCheck } from './src/lib/appCheck';
import { dispatchForRoute, pushTarget } from './src/lib/pushRouting';
import { perfMark, perfBegin, perfNow } from './src/lib/perf';
import { notificationTargets, pullConversationNow, openLocalDb } from './src/localdb';
import { ShareIntentProvider, useShareIntentContext } from 'expo-share-intent';
import ShareToChat from './src/screens/ShareToChat';
import { Linking as RNLinking } from 'react-native';

const navRef = createNavigationContainerRef();

// Foreground display behaviour — must be set once at module load.
installForegroundHandler();

// App Check (F2): initializes only on web with a configured reCAPTCHA key;
// no-op on native until a native attestation module is added. Never throws.
initAppCheck();

// Fetch the message a notification points at NOW (on arrival and on tap): one
// document read straight into the local DB, independent of the boot sync /
// history backfill / realtime listener — so the chat already shows it when it
// opens. Queued until the local DB is open (cold start) or the network returns.
// Never changes the "active conversation", so it never suppresses other banners.
function prefetchFromData(data: unknown) {
  const target = pushTarget(routeFromNotification(data));
  if (!target) return;
  if (target.messageId) void notificationTargets.request(target.conversationId, target.messageId);
  else void pullConversationNow(target.conversationId).catch(() => {});
}

// Try to navigate to a tapped notification's destination. Returns false when it
// can't be applied yet (navigator not mounted, or the authed RootStack — which
// holds Conversation/JoinRequests/Tabs — isn't up), so the caller can retry.
function tryDispatchPush(data: unknown, authed: boolean): boolean {
  const decision = dispatchForRoute(routeFromNotification(data));
  if (decision.kind === 'none') return true;
  if (decision.kind === 'url') { void RNLinking.openURL(decision.href); return true; }
  if (!navRef.isReady() || !authed) return false;   // keep pending; retry later
  if (decision.name === 'Tabs') { (navRef as any).navigate('Tabs'); return true; }
  (navRef as any).navigate(decision.name, decision.params);
  return true;
}

const AuthStack = createNativeStackNavigator();
const OnboardingStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

// Content shared INTO the app from another app (Android ACTION_SEND / iOS Share
// Extension). When one arrives and we're signed in, route to the chat picker.
function ShareIntentHandler({ authed }: { authed: boolean }) {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  useEffect(() => {
    if (!hasShareIntent || !authed) return;
    let cancelled = false;
    const go = () => {
      if (cancelled) return;
      if (!navRef.isReady()) { setTimeout(go, 150); return; }
      const file = shareIntent.files?.[0];
      if (file?.path) {
        (navRef as any).navigate('ShareToChat', {
          image: { uri: file.path, mimeType: file.mimeType, size: (file as any).size },
        });
      } else {
        const text = shareIntent.text ?? shareIntent.webUrl ?? '';
        if (text) (navRef as any).navigate('ShareToChat', { text });
      }
      resetShareIntent();
    };
    go();
    return () => { cancelled = true; };
  }, [hasShareIntent, authed]);
  return null;
}

function AuthFlow() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Splash" component={Splash} />
      <AuthStack.Screen name="Welcome" component={Welcome} />
      <AuthStack.Screen name="PhoneEntry" component={PhoneEntry} />
      <AuthStack.Screen name="Otp" component={Otp} />
      <AuthStack.Screen name="EmailLogin" component={EmailLogin} />
      <AuthStack.Screen name="EmailEntry" component={EmailEntry} />
      <AuthStack.Screen name="EmailOtp" component={EmailOtp} />
    </AuthStack.Navigator>
  );
}

function OnboardingFlow() {
  return (
    <OnboardingStack.Navigator screenOptions={{ headerShown: false }}>
      <OnboardingStack.Screen name="ProfileCompletion" component={ProfileCompletion} />
    </OnboardingStack.Navigator>
  );
}

const TAB_ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Chats:    { active: 'chatbubbles',       inactive: 'chatbubbles-outline' },
  Status:   { active: 'radio',             inactive: 'radio-outline' },
  Clips:    { active: 'play-circle',       inactive: 'play-circle-outline' },
  Settings: { active: 'settings',          inactive: 'settings-outline' },
};

function MainTabs() {
  const { c } = useClipsCopy();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const unread = useUnreadTotal();
  return (
    <Tabs.Navigator
      backBehavior="history"
      // The floating pill is positioned manually with `bottom: insets.bottom + 10`,
      // so BottomTabBar must NOT also add its own bottom safe-area padding — on
      // Android 15 (edge-to-edge) that ~48px padding, subtracted from the fixed
      // 72px height, collapsed the content area and hid the icons. BottomTabBar
      // takes `insets` as a PROP (not from context), so override it here.
      tabBar={(props) => (
        <BottomTabBar {...props} insets={{ ...props.insets, bottom: 0 }} />
      )}
      // Telegram-style floating pill bar: detached from the screen edges,
      // fully rounded, with a soft-blue pill behind the active tab.
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor:   colors.action.subtleFg,
        tabBarInactiveTintColor: colors.text.secondary,
        tabBarActiveBackgroundColor: colors.action.subtle,
        tabBarStyle: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: insets.bottom + 10,
          height: 72,
          borderRadius: 999,
          backgroundColor: colors.background.surface,
          borderTopWidth: 0,
          paddingHorizontal: 6,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 6 },
          elevation: 12,
        },
        tabBarItemStyle: {
          borderRadius: 999,
          overflow: 'hidden',
          marginVertical: 9,
          marginHorizontal: 4,
          paddingTop: 6,
          paddingBottom: 6,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700', marginTop: 2 },
        tabBarIcon: ({ focused, color, size }) => {
          const set = TAB_ICONS[route.name];
          const name = focused ? set.active : set.inactive;
          return <Ionicons name={name} size={size ?? 22} color={color} />;
        },
      })}
    >
      <Tabs.Screen
        name="Chats"
        component={ChatsList}
        options={{ title: c('Chats', 'المحادثات'), tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined }}
      />
      <Tabs.Screen name="Status" component={Status} options={{ title: c('Status', 'الحالات') }} />
      <Tabs.Screen name="Clips" component={ClipsFeed} options={{ title: c('Clips', 'مقاطع') }} />
      <Tabs.Screen name="Settings" component={Settings} options={{ title: c('Settings', 'الإعدادات') }} />
    </Tabs.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const { profileCompleted, userTheme, profileError, retryProfile } = useAccountProfile(user?.uid ?? null);
  const { t } = useTranslation();

  useEffect(() => onAuthStateChanged(auth, u => {
    perfMark('auth:resolved', { signedIn: !!u }, true);
    // Start SQLite as soon as Firebase restores the account. A cold-start push
    // is queued independently of navigation; it must not wait for the profile
    // snapshot, onboarding cache or ChatsList to mount before downloading.
    if (u) {
      const started = perfNow();
      void openLocalDb(u.uid).then(() => {
        if (auth.currentUser?.uid === u.uid) {
          perfMark('startup:messages:ready', { durationMs: Math.round(perfNow() - started) });
        }
      }).catch(() => {
        // Screens retry opening the database. A storage failure must not break
        // auth or leave an unhandled rejection on launch.
        perfMark('startup:messages:error');
      });
    }
    setUser(u);
    setReady(true);
  }), []);

  // Invite deep links (offlinesms://join/{code} | https://links.offlinesms.com
  // /join/{code}, plus legacy offlinesms.com links). If logged in + onboarded,
  // open JoinGroup now; otherwise stash the code and replay it after auth
  // (effect below).
  const authedRef = useRef(false);
  authedRef.current = !!user && profileCompleted === true;
  const accountRef = useRef<string | null>(null);
  accountRef.current = user?.uid ?? null;
  const clipLinks = useRef<ReturnType<typeof createPendingClipNavigation> | null>(null);
  if (!clipLinks.current) clipLinks.current = createPendingClipNavigation({
    take: takePendingClip, save: setPendingClip,
    account: () => authedRef.current && accountRef.current === auth.currentUser?.uid ? accountRef.current : null,
    ready: () => navRef.isReady(), open: clipId => (navRef as any).navigate('ClipViewer', { clipId }),
  });
  const inviteLinks = useRef<ReturnType<typeof createPendingInviteNavigation> | null>(null);
  if (!inviteLinks.current) inviteLinks.current = createPendingInviteNavigation({
    take: takePendingInvite, save: setPendingInvite,
    account: () => authedRef.current && accountRef.current === auth.currentUser?.uid ? accountRef.current : null,
    ready: () => navRef.isReady(), open: code => (navRef as any).navigate('JoinGroup', { code }),
  });
  useEffect(() => {
    function handle(url: string | null) {
      const clipId = clipIdFromUrl(url);
      if (clipId) {
        void clipLinks.current?.receive(clipId).catch(() => {});
        return;
      }
      const code = inviteCodeFromUrl(url);
      if (!code) return;
      void inviteLinks.current?.receive(code).catch(() => {});
    }
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', e => handle(e.url));
    return () => sub.remove();
  }, []);

  // Register for push once authenticated + onboarded (asks permission then).
  useEffect(() => {
    if (user && profileCompleted === true) void registerForPush(user.uid);
  }, [user, profileCompleted]);

  // A tapped-notification destination we couldn't navigate to yet (cold start:
  // navigator not mounted / auth not resolved). Drained once both are ready.
  const pushTaps = useRef<ReturnType<typeof createPushTapQueue> | null>(null);
  if (!pushTaps.current) pushTaps.current = createPushTapQueue({
    dispatch: data => tryDispatchPush(data, authedRef.current),
    received: (id, data) => {
      void dismissNotificationById(id);
      const tappedId = (data as { messageId?: unknown } | undefined)?.messageId;
      perfMark('push:tap');
      perfBegin('push_to_visible', { id: typeof tappedId === 'string' ? tappedId : null });
      perfBegin('push_to_viewable', { id: typeof tappedId === 'string' ? tappedId : null, phase: 'viewable' });
      prefetchFromData(data);
    },
    consumed: id => {
      // Clear only the response just routed. A newer tap may already be native's
      // last response, and must remain available if the app restarts.
      try {
        if (Notifications.getLastNotificationResponse()?.notification.request.identifier === id) {
          Notifications.clearLastNotificationResponse();
        }
      } catch { /* Unavailable on web; routing already succeeded. */ }
    },
  });
  const drainPush = useCallback(() => { pushTaps.current?.drain(); }, []);

  // Route notification taps (cold start + warm) and pre-sync on arrival/tap.
  // Cold-start tap is delivered via getLastNotificationResponseAsync; the
  // listener can ALSO fire for that same response, so dedupe by notification
  // identifier to avoid double navigation.
  useEffect(() => {
    const handleTap = (resp: Notifications.NotificationResponse | null) => {
      if (!resp) return;
      pushTaps.current?.receive(resp.notification.request.identifier, resp.notification.request.content.data);
    };
    // Sync while JS is running in the foreground. A system-displayed push does
    // not itself run this listener when the app is terminated.
    const subRecv = Notifications.addNotificationReceivedListener(n => {
      prefetchFromData(n.request.content.data);
    });
    Notifications.getLastNotificationResponseAsync().then(handleTap).catch(() => {});
    const subTap = Notifications.addNotificationResponseReceivedListener(handleTap);
    return () => { subRecv.remove(); subTap.remove(); };
  }, [drainPush]);

  // Once authed + onboarded (and the navigator is mounted), drain any pending
  // notification tap. Retries until the authed RootStack is ready so a cold-
  // start tap reliably lands on the right chat.
  useEffect(() => {
    if (!(user && profileCompleted === true)) return;
    let cancelled = false;
    const tryDrain = () => {
      if (cancelled || !pushTaps.current?.hasPending()) return;
      drainPush();
      if (!pushTaps.current?.hasPending()) return;
      setTimeout(tryDrain, 150);
    };
    tryDrain();
    return () => { cancelled = true; };
  }, [user, profileCompleted, drainPush]);

  // Replay a stashed invite once the user is authenticated + onboarded.
  useEffect(() => {
    if (!(user && profileCompleted === true)) return;
    void inviteLinks.current?.drain().catch(() => {});
  }, [user, profileCompleted]);

  // A protected clip link is replayed after sign-in; the viewer asks the
  // server for current access before showing metadata or obtaining media.
  useEffect(() => {
    if (!(user && profileCompleted === true)) return;
    void clipLinks.current?.drain().catch(() => {});
  }, [user, profileCompleted]);

  // Mirror the user's chats into the local SQLite DB for the whole session.
  useChatListPersistence(user?.uid);
  // Presence: online while foregrounded, last-seen on background/logout.
  usePresence(user?.uid);

  if (!ready) return null;

  return (
    <ShareIntentProvider>
    <ThemeProvider userPreference={userTheme}>
    <OfflineProvider>
    <SafeAreaProvider>
    <KeyboardProvider>
      <ErrorBoundary>
      <ShareIntentHandler authed={!!user && profileCompleted === true} />
      <NavigationContainer ref={navRef} onReady={() => { drainPush(); void clipLinks.current?.drain().catch(() => {}); void inviteLinks.current?.drain().catch(() => {}); }}>
        {!user ? (
          <AuthFlow />
        ) : profileCompleted === null ? (
          profileError ? <ErrorState fullPage title={t('profileStartup.errorTitle')}
            description={t('profileStartup.errorDescription')}
            primaryAction={{ label: t('profileStartup.retry'), onPress: retryProfile }} />
            : <LoadingState fullPage title={t('profileStartup.loading')} />
        ) : profileCompleted === false ? (
          <OnboardingFlow />
        ) : (
          <RootStack.Navigator key={user.uid} screenOptions={{ headerShown: false }}>
            <RootStack.Screen name="Tabs" component={MainTabs} />
            <RootStack.Screen name="NewChatMenu" component={NewChatMenu} />
            <RootStack.Screen name="NewChat" component={NewChat} />
            <RootStack.Screen name="NewGroup" component={NewGroup} />
            <RootStack.Screen name="GroupCreateInfo" component={GroupCreateInfo} />
            <RootStack.Screen name="Conversation" component={Conversation} />
            <RootStack.Screen name="ImagePreview" component={ImagePreviewScreen} />
            <RootStack.Screen name="ImageViewer" component={ImageViewerScreen} options={{ presentation: 'fullScreenModal' }} />
            <RootStack.Screen name="StatusComposer" component={StatusComposer} options={{ presentation: 'fullScreenModal' }} />
            <RootStack.Screen name="StatusViewer" component={StatusViewer} options={{ presentation: 'fullScreenModal' }} />
            <RootStack.Screen name="ClipViewer" component={ClipViewer} options={{ presentation: 'fullScreenModal' }} />
            <RootStack.Screen name="ClipProfile" component={ClipProfile} />
            <RootStack.Screen name="ClipPreferences" component={ClipPreferences} />
            <RootStack.Screen name="ClipComposer" component={ClipComposer} options={{ presentation: 'fullScreenModal' }} />
            <RootStack.Screen name="ClipDrafts" component={ClipDrafts} />
            <RootStack.Screen name="ClipFollowRequests" component={ClipFollowRequests} />
            <RootStack.Screen name="SocialActivity" component={SocialActivity} />
            <RootStack.Screen name="GroupInvitations" component={GroupInvitations} />
            <RootStack.Screen name="GroupInfo" component={GroupInfo} />
            <RootStack.Screen name="EditGroup" component={EditGroup} />
            <RootStack.Screen name="AddMembers" component={AddMembers} />
            <RootStack.Screen name="JoinRequests" component={JoinRequests} />
            <RootStack.Screen name="JoinGroup" component={JoinGroup} options={{ presentation: 'modal' }} />
            <RootStack.Screen name="ForwardPicker" component={ForwardPicker} />
            <RootStack.Screen name="ShareToChat" component={ShareToChat} />
            <RootStack.Screen name="MessageInfo" component={MessageInfo} />
            <RootStack.Screen name="TransactionDetail" component={TransactionDetail} />
            <RootStack.Screen name="RequestPoints" component={RequestPoints} />
            <RootStack.Screen name="MyPointsRequests" component={MyPointsRequests} />
            <RootStack.Screen name="TransferPoints" component={TransferPoints} />
            <RootStack.Screen name="ChatWallpaper" component={ChatWallpaper} />
            <RootStack.Screen name="NotificationSettings" component={NotificationSettings} />
            <RootStack.Screen name="SmsBatchReport" component={SmsBatchReport} />
            <RootStack.Screen name="Points" component={Points} />
            <RootStack.Screen name="Privacy" component={Privacy} />
            <RootStack.Screen name="Devices" component={Devices} />
            <RootStack.Screen name="SmsEscalation" component={SmsEscalation} />
            <RootStack.Screen name="SupportTicket" component={SupportTicket} />
            <RootStack.Screen name="EditProfile" component={EditProfile} />
            <RootStack.Screen name="CreatePin" component={CreatePin} />
            <RootStack.Screen name="LinkPhone" component={LinkPhone} />
            <RootStack.Screen name="ChangeEmail" component={ChangeEmail} />
            <RootStack.Screen name="Permissions" component={Permissions} />
            <RootStack.Screen name="FindFriends" component={FindFriends} />
            <RootStack.Screen name="IncomingCall" component={IncomingCall} options={{ presentation: 'fullScreenModal' }} />
          </RootStack.Navigator>
        )}
      </NavigationContainer>
      </ErrorBoundary>
    </KeyboardProvider>
    </SafeAreaProvider>
    </OfflineProvider>
    </ThemeProvider>
    </ShareIntentProvider>
  );
}
