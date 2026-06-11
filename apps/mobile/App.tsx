import { useEffect, useRef, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import ProfileCompletion from './src/screens/ProfileCompletion';
import CreatePin from './src/screens/CreatePin';
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
import AddMembers from './src/screens/AddMembers';
import JoinRequests from './src/screens/JoinRequests';
import ForwardPicker from './src/screens/ForwardPicker';
import MessageInfo from './src/screens/MessageInfo';
import TransactionDetail from './src/screens/TransactionDetail';
import BuyPoints from './src/screens/BuyPoints';
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
import { dispatchForRoute } from './src/lib/pushRouting';
import { Linking as RNLinking } from 'react-native';

const navRef = createNavigationContainerRef();

// Foreground display behaviour — must be set once at module load.
installForegroundHandler();

function routeFromPush(data: unknown) {
  const decision = dispatchForRoute(routeFromNotification(data));
  if (decision.kind === 'none') return;
  if (decision.kind === 'url') { void RNLinking.openURL(decision.href); return; }
  if (!navRef.isReady()) return;
  if (decision.name === 'Tabs') { (navRef as any).navigate('Tabs'); return; }
  (navRef as any).navigate(decision.name, decision.params);
}

const AuthStack = createNativeStackNavigator();
const OnboardingStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

function AuthFlow() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Splash" component={Splash} />
      <AuthStack.Screen name="Welcome" component={Welcome} />
      <AuthStack.Screen name="PhoneEntry" component={PhoneEntry} />
      <AuthStack.Screen name="Otp" component={Otp} />
      <AuthStack.Screen name="EmailLogin" component={EmailLogin} />
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
    setUser(u);
    setReady(true);
    if (!u) { setProfileCompleted(null); setUserTheme(null); }
  }), []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(doc(db, 'users', user.uid), snap => {
      setProfileCompleted(snap.exists() ? snap.data()?.profileCompleted === true : false);
      const pref = snap.data()?.preferredTheme as ThemePreference | undefined;
      if (pref) setUserTheme(pref);
    });
  }, [user]);

  // Invite deep links (offlinesms://join/{code} | https://offlinesms.com/join/
  // {code}). If logged in + onboarded, open JoinGroup now; otherwise stash the
  // code and replay it after auth (effect below).
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

  // Route notification taps (cold start + warm). Cold-start tap is delivered
  // via getLastNotificationResponseAsync.
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then(resp => {
      if (resp) routeFromPush(resp.notification.request.content.data);
    });
    const sub = Notifications.addNotificationResponseReceivedListener(resp => {
      routeFromPush(resp.notification.request.content.data);
    });
    return () => sub.remove();
  }, []);

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
    <ThemeProvider userPreference={userTheme}>
    <OfflineProvider>
    <SafeAreaProvider>
      <ErrorBoundary>
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
            <RootStack.Screen name="AddMembers" component={AddMembers} />
            <RootStack.Screen name="JoinRequests" component={JoinRequests} />
            <RootStack.Screen name="JoinGroup" component={JoinGroup} options={{ presentation: 'modal' }} />
            <RootStack.Screen name="ForwardPicker" component={ForwardPicker} />
            <RootStack.Screen name="MessageInfo" component={MessageInfo} />
            <RootStack.Screen name="TransactionDetail" component={TransactionDetail} />
            <RootStack.Screen name="BuyPoints" component={BuyPoints} />
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
            <RootStack.Screen name="Permissions" component={Permissions} />
            <RootStack.Screen name="FindFriends" component={FindFriends} />
            <RootStack.Screen name="IncomingCall" component={IncomingCall} options={{ presentation: 'fullScreenModal' }} />
          </RootStack.Navigator>
        )}
      </NavigationContainer>
      </ErrorBoundary>
    </SafeAreaProvider>
    </OfflineProvider>
    </ThemeProvider>
  );
}
