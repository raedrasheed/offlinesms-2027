// Callable: getSupportedPhoneCountries — countries public phone sign-in is
// available for. UNAUTH (called from the sign-in screen).
//
//   • Legacy callers (no `v`) always get [] — old builds can only speak the
//     retired protocol, so they show their "no countries available" state
//     instead of offering a flow the server refuses.
//   • `{ v: 2 }` (current builds) get the live list ONLY while sign-in sending
//     is allowed by the verification policy (env PHONE_AUTH_ENABLED + smsConfig/otp
//     master/stop/sender + signin.enabled) and a live relay covers the country.
//     Any config read failure ⇒ unavailable (fail closed).

import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { loadActiveRelayDevices } from '../sms/countryRouting';
import { supportedCountriesForDevices } from '../sms/relayLogic';
import { appCheckOptions } from '../lib/appCheck';
import { loadPhoneAuthConfig, phoneAuthSendingAllowed } from '../phoneAuth/config';

const REGION = 'us-central1';

export const getSupportedPhoneCountries = onCall({ region: REGION, ...appCheckOptions() }, async (request) => {
  if ((request.data as { v?: unknown } | null)?.v !== 2) return { countries: [] as string[] };
  try {
    const cfg = await loadPhoneAuthConfig(getFirestore());
    if (!phoneAuthSendingAllowed(cfg)) return { available: false, countries: [] as string[] };
    const countries = supportedCountriesForDevices(await loadActiveRelayDevices(cfg.businessId!), Date.now());
    return { available: countries.length > 0, countries };
  } catch {
    return { available: false, countries: [] as string[] };
  }
});
