import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from './src/lib/firebase';
import { ThemeProvider } from './src/context/ThemeContext';
import type { ThemePreference } from './src/lib/user';
import './src/i18n';

import Welcome from './src/screens/Welcome';
import PhoneEntry from './src/screens/PhoneEntry';
import Otp from './src/screens/Otp';
import EmailLogin from './src/screens/EmailLogin';
import ProfileCompletion from './src/screens/ProfileCompletion';
import ChatsList from './src/screens/ChatsList';
import Conversation from './src/screens/Conversation';
import NewChat from './src/screens/NewChat';
import NewGroup from './src/screens/NewGroup';
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

const AuthStack = createNativeStackNavigator();
const OnboardingStack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();
const RootStack = createNativeStackNavigator();

function AuthFlow() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
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

function MainTabs() {
  return (
    <Tabs.Navigator screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="Chats" component={ChatsList} />
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

  if (!ready) return null;

  return (
    <ThemeProvider userPreference={userTheme}>
    <SafeAreaProvider>
      <NavigationContainer>
        {!user ? (
          <AuthFlow />
        ) : profileCompleted === null ? (
          null /* waiting for users/{uid} snapshot */
        ) : profileCompleted === false ? (
          <OnboardingFlow />
        ) : (
          <RootStack.Navigator screenOptions={{ headerShown: false }}>
            <RootStack.Screen name="Tabs" component={MainTabs} />
            <RootStack.Screen name="NewChat" component={NewChat} />
            <RootStack.Screen name="NewGroup" component={NewGroup} />
            <RootStack.Screen name="Conversation" component={Conversation} />
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
          </RootStack.Navigator>
        )}
      </NavigationContainer>
    </SafeAreaProvider>
    </ThemeProvider>
  );
}
