// Callable: getSignInMethods — the caller's OWN sign-in methods, for Settings.
// Authenticated, read-only, sends nothing. Shows the email and phone the Auth
// record actually carries (the values sign-in resolves), whether the email
// add/change flow is available, and whether a change is mid-way.

import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { appCheckOptions } from '../lib/appCheck';
import { authFreshness } from '../phoneLink/gates';
import { readEmailSettings } from './requestEmailChangeCode';
import { EMAIL_CHANGE_COLLECTIONS as C, EMAIL_CHANGE_LIMITS as L } from './logic';

export async function handleGetSignInMethods(request: CallableRequest<unknown>) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'auth-required');
  const db = getFirestore();
  const [user, settings, op] = await Promise.all([
    getAuth().getUser(uid),
    readEmailSettings(db),
    db.collection(C.ops).doc(uid).get(),
  ]);
  const stage = op.exists ? (op.get('stage') as string) : null;
  const token = request.auth!.token as { auth_time?: number };
  return {
    email: user.email ?? null,
    emailVerified: user.emailVerified === true,
    phone: user.phoneNumber ?? null,
    emailChange: {
      available: settings.enabled,
      pendingRecovery: stage === 'verified' || stage === 'auth-updated',
      reauthRequired: authFreshness(token.auth_time, Date.now(), L.reauthMaxAgeSec, user.tokensValidAfterTime) !== 'ok',
      codeTtlSec: L.codeTtlSec,
    },
  };
}

export const getSignInMethods = onCall({ region: 'us-central1', ...appCheckOptions() }, handleGetSignInMethods);
