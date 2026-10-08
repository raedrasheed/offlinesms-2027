// Callable: verifyPhoneOtp — the ORIGINAL public phone verification endpoint. RETIRED.
//
// It accepted (phone, code) without any session binding, deleted the shared
// rate-limit state on success, treated any Auth lookup error as "no account",
// and honoured a fixed review credential with no challenge at all. It now
// refuses before reading the payload: no account creation, no custom token, no
// wallet credit, no test-number bypass. Outstanding legacy `otpChallenges`
// documents are inert. Use functions/src/phoneAuth/verifyPhoneAuthCode.ts.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { appCheckOptions } from '../lib/appCheck';
import { LEGACY_PHONE_OTP_ERROR } from './requestPhoneOtp';

const REGION = 'us-central1';

export const verifyPhoneOtp = onCall({ region: REGION, ...appCheckOptions() }, async () => {
  console.warn('[verifyPhoneOtp] refused: legacy endpoint retired');
  throw new HttpsError('failed-precondition', LEGACY_PHONE_OTP_ERROR);
});
