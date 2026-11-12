import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  browserSessionPersistence, initializeAuth, inMemoryPersistence,
  onAuthStateChanged, signInWithCustomToken, signOut,
} from 'firebase/auth';
import {
  collection, doc, getDocFromServer, initializeFirestore, limit,
  memoryLocalCache, onSnapshot, orderBy, query, where,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getDownloadURL, getStorage, ref } from 'firebase/storage';
import { initializeFirebaseClient } from './firebase-client.js';
import { isProductionFirebaseConfig } from './firebase-config.js';

const sdk = {
  initializeApp, initializeAppCheck, ReCaptchaEnterpriseProvider,
  browserSessionPersistence, initializeAuth, inMemoryPersistence,
  onAuthStateChanged, signInWithCustomToken, signOut,
  collection, doc, getDocFromServer, initializeFirestore, limit,
  memoryLocalCache, onSnapshot, orderBy, query, where,
  getFunctions, httpsCallable, getDownloadURL, getStorage, ref,
};

async function loadHostingConfig() {
  const response = await fetch('/__/firebase/init.json', { cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('Firebase Hosting configuration is unavailable.');
  return response.json();
}

export async function loadFirebaseClient() {
  const bundledConfig = typeof __OFFLINESMS_WEB_FIREBASE_CONFIG__ === 'object'
    ? __OFFLINESMS_WEB_FIREBASE_CONFIG__ : null;
  const config = bundledConfig ?? await loadHostingConfig();
  if (!isProductionFirebaseConfig(config)) {
    throw new Error('Firebase is not configured for OfflineSMS production.');
  }

  const appCheckSiteKey = typeof __OFFLINESMS_WEB_APP_CHECK_SITE_KEY__ === 'string'
    ? __OFFLINESMS_WEB_APP_CHECK_SITE_KEY__ : '';
  return initializeFirebaseClient(sdk, config, { appCheckSiteKey });
}
