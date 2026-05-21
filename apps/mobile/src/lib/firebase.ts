// Firebase client (mobile · web + native)
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth, getAuth, getReactNativePersistence,
  signInWithPhoneNumber, RecaptchaVerifier,
} from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
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

export const db = getFirestore(app);
export const storage = getStorage(app);

// Connect to local emulators when EXPO_PUBLIC_USE_EMULATORS=1
if (process.env.EXPO_PUBLIC_USE_EMULATORS === '1') {
  try {
    connectFirestoreEmulator(db, 'localhost', 8080);
  } catch {}
}
