// Callable: verifyPhoneOtp — PUBLIC phone sign-in / registration. DISABLED.
//
// This endpoint used to accept any (phone, code) pair, find-or-CREATE a Firebase
// Auth user for the number (plus a 50-point welcome wallet), and return a custom
// token. It also accepted a fixed code for a hard-coded test number with no
// challenge at all.
//
// It now refuses before reading the payload or touching Firestore/Auth: no
// account creation, no custom token, no wallet credit, and no test-number
// bypass. Outstanding `otpChallenges` documents are therefore inert; see
// docs/PHONE_LINKING_SECURITY.md for the (manual, dry-run-first) cleanup.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { appCheckOptions } from '../lib/appCheck';
import { PHONE_SIGNIN_DISABLED } from './requestPhoneOtp';

const REGION = 'us-central1';

export const verifyPhoneOtp = onCall({ region: REGION, ...appCheckOptions() }, async () => {
  console.warn('[verifyPhoneOtp] refused: public phone sign-in is disabled');
  throw new HttpsError('failed-precondition', PHONE_SIGNIN_DISABLED);
});
