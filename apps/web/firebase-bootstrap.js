import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import {
  beforeAuthStateChanged, browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, inMemoryPersistence,
  onAuthStateChanged, signInWithCustomToken, signOut,
} from 'firebase/auth';
import {
  addDoc, collection, doc, documentId, getDocFromServer, getDocsFromServer, initializeFirestore, limit,
  memoryLocalCache, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getBlob, getDownloadURL, getStorage, ref, uploadBytes, uploadBytesResumable } from 'firebase/storage';
import { initializeFirebaseClient } from './firebase-client.js';
import { isProductionFirebaseConfig } from './firebase-config.js';

const sdk = {
  initializeApp, initializeAppCheck, ReCaptchaEnterpriseProvider,
  beforeAuthStateChanged, browserLocalPersistence, indexedDBLocalPersistence, initializeAuth, inMemoryPersistence,
  onAuthStateChanged, signInWithCustomToken, signOut,
  addDoc, collection, doc, documentId, getDocFromServer, getDocsFromServer, initializeFirestore, limit,
  memoryLocalCache, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where,
  getFunctions, httpsCallable, getBlob, getDownloadURL, getStorage, ref, uploadBytes, uploadBytesResumable,
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
