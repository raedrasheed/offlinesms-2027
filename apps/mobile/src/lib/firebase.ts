// Firebase client (mobile · web + native)
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth, getAuth,
  signInWithPhoneNumber, RecaptchaVerifier,
} from 'firebase/auth';
// In Firebase JS SDK 11+, `getReactNativePersistence` is exposed from the
// main `firebase/auth` entry via the package's `react-native` conditional
// export. Metro resolves to the RN bundle automatically. The subpath
// `firebase/auth/react-native` was removed.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getReactNativePersistence } = require('firebase/auth');
import { getFirestore, initializeFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const config = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
};

export const app = getApps().length ? getApp() : initializeApp(config);

export const auth = Platform.OS === 'web'
  ? getAuth(app)
  : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });

// On native, Firestore's default WebChannel streaming transport is
// unreliable in the React Native networking stack and spams
// "RPC 'Listen' stream transport errored" while silently dropping
// snapshot updates. Forcing long-polling makes listeners reliable.
// Web keeps the default transport (WebChannel works fine in browsers).
export const db = Platform.OS === 'web'
  ? getFirestore(app)
  : initializeFirestore(app, { experimentalForceLongPolling: true });
export const storage = getStorage(app);

// Connect to local emulators when EXPO_PUBLIC_USE_EMULATORS=1
if (process.env.EXPO_PUBLIC_USE_EMULATORS === '1') {
  try {
    connectFirestoreEmulator(db, 'localhost', 8080);
  } catch {}
}
