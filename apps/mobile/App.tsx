import { useCallback, useEffect, useRef, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './src/lib/firebase';
import { ThemeProvider } from './src/context/ThemeContext';
import { OfflineProvider } from './src/context/OfflineContext';
import type { ThemePreference } from './src/lib/user';
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
import Calls from './src/screens/Calls';
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
import { inviteCodeFromUrl, setPendingInvite, takePendingInvite } from './src/lib/deepLinks';
import * as Notifications from 'expo-notifications';
import { installForegroundHandler, registerForPush, routeFromNotification } from './src/lib/notifications';
import { initAppCheck } from './src/lib/appCheck';
import { dispatchForRoute, pushTarget } from './src/lib/pushRouting';
import { perfMark, perfBegin } from './src/lib/perf';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { notificationTargets, pullConversationNow } from './src/localdb';
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
  Calls:    { active: 'call',              inactive: 'call-outline' },
  Settings: { active: 'settings',          inactive: 'settings-outline' },
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const unread = useUnreadTotal();
  return (
    <Tabs.Navigator
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
        tabBarActiveTintColor:   '#1F7BA8',
        tabBarInactiveTintColor: '#3A4452',
        tabBarActiveBackgroundColor: '#E3F1FA',
        tabBarStyle: {
          position: 'absolute',
          left: 12,
          right: 12,
          bottom: insets.bottom + 10,
          height: 72,
          borderRadius: 999,
          backgroundColor: '#FFFFFF',
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
        options={{ tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined }}
      />
      <Tabs.Screen name="Status" component={Status} />
      <Tabs.Screen name="Calls" component={Calls} />
      <Tabs.Screen name="Settings" component={Settings} />
    </Tabs.Navigator>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  // null  = not loaded yet, false = needs onboarding, true = complete.
  const [profileCompleted, setProfileCompleted] = useState<boolean | null>(null);
  const [userTheme, setUserTheme] = useState<ThemePreference | null>(null);

  useEffect(() => onAuthStateChanged(auth, u => {
    perfMark('auth:resolved', { signedIn: !!u }, true);
    setUser(u);
    setReady(true);
    if (!u) { setProfileCompleted(null); setUserTheme(null); }
  }), []);

  // Startup: the main UI used to wait for the users/{uid} snapshot — a network
  // round-trip on every launch (React Native has no persistent Firestore cache)
  // and a blank screen when starting offline. A user who completed onboarding
  // before goes straight to the (locally cached) chat list; the live snapshot
  // still runs and corrects the state if it changed.
  useEffect(() => {
    if (!user) return;
    const key = `profileCompleted.v1:${user.uid}`;
    let live = false;
    AsyncStorage.getItem(key).then(v => {
      if (!live && v === '1') setProfileCompleted(prev => (prev === null ? true : prev));
    }).catch(() => {});
    return onSnapshot(doc(db, 'users', user.uid), snap => {
      live = true;
      const done = snap.exists() ? snap.data()?.profileCompleted === true : false;
      setProfileCompleted(done);
      void AsyncStorage.setItem(key, done ? '1' : '0').catch(() => {});
      const pref = snap.data()?.preferredTheme as ThemePreference | undefined;
      if (pref) setUserTheme(pref);
    });
  }, [user]);

  // Invite deep links (offlinesms://join/{code} | https://links.offlinesms.com
  // /join/{code}, plus legacy offlinesms.com links). If logged in + onboarded,
  // open JoinGroup now; otherwise stash the code and replay it after auth
  // (effect below).
  const authedRef = useRef(false);
  authedRef.current = !!user && profileCompleted === true;
  useEffect(() => {
    function handle(url: string | null) {
      const code = inviteCodeFromUrl(url);
      if (!code) return;
      if (authedRef.current && navRef.isReady()) (navRef as any).navigate('JoinGroup', { code });
      else void setPendingInvite(code);
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
  const pendingPushRef = useRef<unknown>(null);
  const drainPush = useCallback(() => {
    if (pendingPushRef.current == null) return;
    if (tryDispatchPush(pendingPushRef.current, authedRef.current)) pendingPushRef.current = null;
  }, []);

  // Route notification taps (cold start + warm) and pre-sync on arrival/tap.
  // Cold-start tap is delivered via getLastNotificationResponseAsync; the
  // listener can ALSO fire for that same response, so dedupe by notification
  // identifier to avoid double navigation.
  useEffect(() => {
    const handled = new Set<string>();
    const handleTap = (resp: Notifications.NotificationResponse | null) => {
      if (!resp) return;
      const id = resp.notification.request.identifier;
      if (id && handled.has(id)) return;
      if (id) handled.add(id);
      const data = resp.notification.request.content.data;
      // Timing (test builds): tap → this message rendered in its conversation.
      const tappedId = (data as { messageId?: unknown } | undefined)?.messageId;
      perfMark('push:tap');
      perfBegin('push_to_visible', { id: typeof tappedId === 'string' ? tappedId : null });
      // Kick a targeted pull immediately so the chat is loaded by the time it
      // opens, then navigate (stashing + retrying if we're not ready yet).
      prefetchFromData(data);
      pendingPushRef.current = data;
      drainPush();
    };
    // Sync the related chat the moment a notification ARRIVES (foreground, and
    // iOS content-available background), so its messages are already local.
    const subRecv = Notifications.addNotificationReceivedListener(n => {
      prefetchFromData(n.request.content.data);
    });
    Notifications.getLastNotificationResponseAsync().then(handleTap);
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
      if (cancelled || pendingPushRef.current == null) return;
      if (tryDispatchPush(pendingPushRef.current, true)) { pendingPushRef.current = null; return; }
      setTimeout(tryDrain, 150);
    };
    tryDrain();
    return () => { cancelled = true; };
  }, [user, profileCompleted]);

  // Replay a stashed invite once the user is authenticated + onboarded.
  useEffect(() => {
    if (!(user && profileCompleted === true)) return;
    let cancelled = false;
    (async () => {
      const code = await takePendingInvite();
      if (!code || cancelled) return;
      const tryNav = () => {
        if (navRef.isReady()) (navRef as any).navigate('JoinGroup', { code });
        else setTimeout(tryNav, 150);
      };
      tryNav();
    })();
    return () => { cancelled = true; };
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
      <NavigationContainer ref={navRef}>
        {!user ? (
          <AuthFlow />
        ) : profileCompleted === null ? (
          null /* waiting for users/{uid} snapshot */
        ) : (
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
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
