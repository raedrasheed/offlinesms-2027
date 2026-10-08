// Callable: getSupportedPhoneCountries — the countries PUBLIC phone sign-in is
// available for. UNAUTH (called from the sign-in screen of older app builds).
//
// Public phone sign-in/registration is disabled on the server (see
// requestPhoneOtp.ts), so this always returns an empty list. Older builds then
// show their existing "no countries available for phone sign-in" state instead
// of offering a flow that the server will refuse. It deliberately performs no
// Firestore reads: an unauthenticated endpoint should not cost anything.
//
// The authenticated phone-LINKING flow reports its own availability through
// getPhoneLinkStatus (functions/src/phoneLink/).

import { onCall } from 'firebase-functions/v2/https';
import { appCheckOptions } from '../lib/appCheck';

const REGION = 'us-central1';

export const getSupportedPhoneCountries = onCall({ region: REGION, ...appCheckOptions() }, async () => {
  return { countries: [] as string[] };
});
