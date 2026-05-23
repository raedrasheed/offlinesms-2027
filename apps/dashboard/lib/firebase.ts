// Firebase client (dashboard).
//
// Initialisation is lazy so that `next build` can collect page data without
// requiring the NEXT_PUBLIC_FIREBASE_* env vars at build time. Modules
// importing `auth`, `db`, etc. don't trigger init until a property is
// accessed (typically in an event handler or effect).

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

function ensureApp(): FirebaseApp {
  if (getApps().length) return getApp();
  return initializeApp({
    apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  });
}

function lazy<T extends object>(factory: () => T): T {
  let value: T | undefined;
  return new Proxy({} as T, {
    get(_, prop, receiver) {
      if (!value) value = factory();
      return Reflect.get(value as any, prop, receiver);
    },
  });
}

export const app: FirebaseApp = lazy(() => ensureApp());
export const auth: Auth = lazy(() => getAuth(ensureApp()));
export const db: Firestore = lazy(() => getFirestore(ensureApp()));
export const storage: FirebaseStorage = lazy(() => getStorage(ensureApp()));
