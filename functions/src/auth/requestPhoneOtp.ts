// Callable: requestPhoneOtp — the ORIGINAL public phone sign-in endpoint. RETIRED.
//
// It minted a sign-in OTP for any caller-supplied number and queued a relay SMS
// with no requester binding, no proof, and a non-transactional per-number limit
// only (the reported SMS-spraying mechanism). Public phone sign-in / sign-up is
// still a supported product flow, but it now runs ONLY through the protected
// protocol in functions/src/phoneAuth/ (startPhoneAuth → requestPhoneAuthCode →
// verifyPhoneAuthCode), which old app builds cannot speak.
//
// This handler refuses before reading the payload or touching Firestore, so no
// challenge, relay job, audit row or SMS can be produced through it by any
// client version or payload (including the former fixed review number). It
// stays exported so the deployed function is REPLACED by this refusal rather
// than left running the old code; old builds get a stable "update the app".

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { appCheckOptions } from '../lib/appCheck';

const REGION = 'us-central1';

/** The single error every legacy public phone OTP call receives. */
export const LEGACY_PHONE_OTP_ERROR = 'app-update-required';

export const requestPhoneOtp = onCall({ region: REGION, ...appCheckOptions() }, async () => {
  console.warn('[requestPhoneOtp] refused: legacy endpoint retired');
  throw new HttpsError('failed-precondition', LEGACY_PHONE_OTP_ERROR);
});
