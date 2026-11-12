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

const projectId = 'offlinesms-prod-2027';
const sdk = {
  initializeApp, initializeAppCheck, ReCaptchaEnterpriseProvider,
  browserSessionPersistence, initializeAuth, inMemoryPersistence,
  onAuthStateChanged, signInWithCustomToken, signOut,
  collection, doc, getDocFromServer, initializeFirestore, limit,
  memoryLocalCache, onSnapshot, orderBy, query, where,
  getFunctions, httpsCallable, getDownloadURL, getStorage, ref,
};

export async function loadFirebaseClient() {
  const response = await fetch('/__/firebase/init.json', { cache: 'no-store', redirect: 'error' });
  if (!response.ok) throw new Error('Firebase Hosting configuration is unavailable.');

  const config = await response.json();
  if (config?.projectId !== projectId || typeof config.apiKey !== 'string' || !config.apiKey.trim()
      || typeof config.appId !== 'string' || !config.appId.trim()) {
    throw new Error('Firebase Hosting is not configured for OfflineSMS production.');
  }

  const appCheckSiteKey = typeof __OFFLINESMS_WEB_APP_CHECK_SITE_KEY__ === 'string'
    ? __OFFLINESMS_WEB_APP_CHECK_SITE_KEY__ : '';
  return initializeFirebaseClient(sdk, config, { appCheckSiteKey });
}
