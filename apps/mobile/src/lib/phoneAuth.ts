// Protected public phone sign-in / sign-up (no account required). Wires the
// pure PhoneAuthFlow to the callables and Firebase Auth. See
// functions/src/phoneAuth/ for the server rules this follows.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { app, auth } from './firebase';
import { solvePow } from './sha256';
import { PhoneAuthFlow, newRequestId, type PhoneAuthApi, type StartResult, type CodeResult, type VerifyResult } from './phoneAuth.flow';

const fns = () => getFunctions(app, 'us-central1');
const INSTALL_KEY = 'offlinesms.installationId';

/** Random per-install id. An abuse SIGNAL only — the server treats it as
 *  untrusted (a reinstall resets it; other limits still apply). */
async function installationId(): Promise<string | null> {
  try {
    const existing = await AsyncStorage.getItem(INSTALL_KEY);
    if (existing) return existing;
    const id = newRequestId() + newRequestId();
    await AsyncStorage.setItem(INSTALL_KEY, id);
    return id;
  } catch {
    return null;
  }
}

const api: PhoneAuthApi = {
  async start(id) {
    return (await httpsCallable<Record<string, unknown>, StartResult>(fns(), 'startPhoneAuth')(id ? { installationId: id } : {})).data;
  },
  async request(p) {
    return (await httpsCallable<typeof p, CodeResult>(fns(), 'requestPhoneAuthCode')(p)).data;
  },
  async verify(p) {
    return (await httpsCallable<typeof p, VerifyResult>(fns(), 'verifyPhoneAuthCode')(p)).data;
  },
};

let flow: PhoneAuthFlow | null = null;

/** One flow per sign-in attempt, shared by PhoneEntry and Otp. */
export async function phoneAuthFlow(reset = false): Promise<PhoneAuthFlow> {
  if (!flow || reset) {
    flow = new PhoneAuthFlow(api, (nonce, e164, bits) => solvePow(nonce, e164, bits), await installationId());
  }
  return flow;
}

/** Countries phone sign-in is open for right now (empty ⇒ unavailable). */
export async function getPhoneAuthAvailability(): Promise<{ available: boolean; countries: string[] }> {
  const res = await httpsCallable<{ v: 2 }, { available?: boolean; countries?: string[] }>(fns(), 'getSupportedPhoneCountries')({ v: 2 });
  const countries = Array.isArray(res.data?.countries) ? res.data.countries : [];
  return { available: res.data?.available === true && countries.length > 0, countries };
}

/** Verify the code and sign in with the returned token. */
export async function verifyPhoneCodeAndSignIn(challengeId: string, code: string): Promise<{ isNewUser: boolean }> {
  const f = await phoneAuthFlow();
  const res = await f.verify(challengeId, code);
  await signInWithCustomToken(auth, res.customToken);
  flow = null; // done with this attempt
  return { isNewUser: res.isNewUser };
}
