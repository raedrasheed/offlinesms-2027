// Callable: requestPhoneOtp — PUBLIC phone sign-in / registration. DISABLED.
//
// This unauthenticated endpoint used to mint a sign-in OTP for ANY caller-
// supplied number and queue it on the relay. It had no account binding, no
// per-source or global limit, and its per-number limit was a non-transactional
// read-then-write, so a single anonymous caller could make the relay text
// arbitrary people (the reported abuse).
//
// Public phone registration is now shut down ON THE SERVER. The handler refuses
// before reading the payload or touching Firestore, so no challenge, relay job,
// audit row, or SMS can be produced by any client version, any payload shape
// (including the old app-review test number), or any caller-supplied flag. It
// stays exported (rather than deleted) so the deployed function is replaced by
// this refusal instead of lingering with the old code, and old app builds get a
// stable, mappable error.
//
// Adding a phone to an EXISTING, email-verified account is a separate,
// authenticated flow: functions/src/phoneLink/.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { appCheckOptions } from '../lib/appCheck';

const REGION = 'us-central1';

/** The single error every public phone sign-in call receives. */
export const PHONE_SIGNIN_DISABLED = 'phone-signin-disabled';

export const requestPhoneOtp = onCall({ region: REGION, ...appCheckOptions() }, async () => {
  // No PII in the log line: the payload is never read.
  console.warn('[requestPhoneOtp] refused: public phone sign-in is disabled');
  throw new HttpsError('failed-precondition', PHONE_SIGNIN_DISABLED);
});
