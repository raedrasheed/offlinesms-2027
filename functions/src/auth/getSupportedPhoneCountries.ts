// Callable: getSupportedPhoneCountries — the ISO alpha-2 countries that phone
// sign-in is currently possible for. UNAUTH by design (called from the sign-in
// screen before the user has an account).
//
// Sign-in OTP is delivered by the designated OTP organization's relay
// (smsConfig/otp.businessId), so a country is "supported" iff that org has a
// live, country-configured relay serving it. The mobile country picker shows
// ONLY these — a user can never request a code for a country no relay covers
// (which would otherwise silently fail). Empty list ⇒ the app shows its
// "no countries available for phone sign-in" state.

import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { loadActiveRelayDevices } from '../sms/countryRouting';
import { supportedCountriesForDevices } from '../sms/relayLogic';

const REGION = 'us-central1';

async function otpBusinessId(db: FirebaseFirestore.Firestore): Promise<string | null> {
  const snap = await db.collection('smsConfig').doc('otp').get();
  const id = snap.exists ? (snap.data()?.businessId as string | undefined) : undefined;
  return id ?? null;
}

export const getSupportedPhoneCountries = onCall({ region: REGION }, async () => {
  const db = getFirestore();
  const businessId = await otpBusinessId(db);
  if (!businessId) return { countries: [] as string[] };

  const devices = await loadActiveRelayDevices(businessId);
  const countries = supportedCountriesForDevices(devices, Date.now());
  return { countries };
});
