// Firebase Admin (server-side) — used by server components / route handlers
// for admin-only data fetches that bypass Firestore rules safely.
//
// Initialisation is lazy so that `next build` can collect page data without
// requiring the service-account env vars to be present at build time. The
// first request that actually needs adminAuth/adminDb triggers init.

import { getApps, initializeApp, cert, App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let _app: App | undefined;
let _auth: Auth | undefined;
let _db: Firestore | undefined;

function ensureApp(): App {
  if (_app) return _app;
  const existing = getApps()[0];
  if (existing) { _app = existing; return _app; }

  const projectId   = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'firebase-admin not configured: set FIREBASE_ADMIN_PROJECT_ID, ' +
      'FIREBASE_ADMIN_CLIENT_EMAIL and FIREBASE_ADMIN_PRIVATE_KEY.'
    );
  }

  _app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return _app;
}

export const adminAuth = new Proxy({} as Auth, {
  get(_, prop, receiver) {
    if (!_auth) _auth = getAuth(ensureApp());
    return Reflect.get(_auth as any, prop, receiver);
  },
});

export const adminDb = new Proxy({} as Firestore, {
  get(_, prop, receiver) {
    if (!_db) _db = getFirestore(ensureApp());
    return Reflect.get(_db as any, prop, receiver);
  },
});
