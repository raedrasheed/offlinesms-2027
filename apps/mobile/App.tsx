import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
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
import { useUnreadTotal } from './src/lib/unreadStore';
import ChatsList from './src/screens/ChatsList';
import Conversation from './src/screens/Conversation';
import NewChat from './src/screens/NewChat';
import NewChatMenu from './src/screens/NewChatMenu';
import NewGroup from './src/screens/NewGroup';
import GroupCreateInfo from './src/screens/GroupCreateInfo';
import GroupInfo from './src/screens/GroupInfo';
import AddMembers from './src/screens/AddMembers';
import ForwardPicker from './src/screens/ForwardPicker';
import MessageInfo from './src/screens/MessageInfo';
import TransactionDetail from './src/screens/TransactionDetail';
import BuyPoints from './src/screens/BuyPoints';
import TransferPoints from './src/screens/TransferPoints';
import SmsBatchReport from './src/screens/SmsBatchReport';
import Status from './src/screens/Status';
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
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor:   '#1F7BA8',
        tabBarInactiveTintColor: '#6B7488',
        tabBarStyle: {
          height: 62 + insets.bottom,
          paddingTop: 10,
          paddingBottom: (insets.bottom || 8) + 4,
        },
        tabBarLabelStyle: { fontSize: 11, marginTop: 6 },
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

  // Mirror the user's chats into the local SQLite DB for the whole session.
  useChatListPersistence(user?.uid);

  if (!ready) return null;

  return (
    <ThemeProvider userPreference={userTheme}>
    <OfflineProvider>
    <SafeAreaProvider>
      <ErrorBoundary>
      <NavigationContainer>
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
            <RootStack.Screen name="GroupInfo" component={GroupInfo} />
            <RootStack.Screen name="AddMembers" component={AddMembers} />
            <RootStack.Screen name="ForwardPicker" component={ForwardPicker} />
            <RootStack.Screen name="MessageInfo" component={MessageInfo} />
            <RootStack.Screen name="TransactionDetail" component={TransactionDetail} />
            <RootStack.Screen name="BuyPoints" component={BuyPoints} />
            <RootStack.Screen name="TransferPoints" component={TransferPoints} />
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
