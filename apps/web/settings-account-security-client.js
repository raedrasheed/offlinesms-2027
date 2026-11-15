import { PhoneAuthFlow } from '../mobile/src/lib/phoneAuth.flow.ts';
import { solvePow } from '../mobile/src/lib/sha256.ts';
import { installationId } from './phone-auth-client.js';

const pinPattern = /^\d{6}$/;
const phonePattern = /^\+[1-9][0-9]{6,14}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function createPinRecord(pin, webCrypto = globalThis.crypto) {
  if (typeof pin !== 'string' || !pinPattern.test(pin)) throw new Error('pin-must-be-6-digits');
  if (!webCrypto?.subtle) throw new Error('pin-requires-secure-context');
  const pinSalt = bytesToHex(webCrypto.getRandomValues(new Uint8Array(16)));
  const hash = await webCrypto.subtle.digest('SHA-256', new TextEncoder().encode(`${pinSalt}:${pin}`));
  return { pinSalt, pinHash: bytesToHex(new Uint8Array(hash)) };
}

function customTokenUid(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some(part => !/^[\w-]+$/.test(part))) return null;
  try {
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(payload, character => character.charCodeAt(0));
    const uid = JSON.parse(new TextDecoder().decode(bytes))?.uid;
    return typeof uid === 'string' ? uid : null;
  } catch {
    return null;
  }
}

export function createSettingsAccountSecurityClient({ sdk, db, auth, requireSession, invoke, call, useAppCheck }) {
  const replayProtected = useAppCheck ? { limitedUseAppCheckTokens: true } : undefined;
  let renewing = false;

  async function continueSession(uid, result) {
    requireSession(uid);
    // The callable result is bound to this account. Firebase validates the
    // token signature on exchange; the UID check prevents any account switch.
    if (!result || (result.uid !== undefined && result.uid !== uid) || customTokenUid(result.customToken) !== uid) {
      throw new Error('account-mismatch');
    }
    if (renewing) throw new Error('service-busy');
    renewing = true;
    let signedOut = false;
    let unguard;
    try {
      unguard = sdk.beforeAuthStateChanged(auth, next => {
        if (!next) signedOut = true;
        else if (next.uid === uid) {
          if (signedOut) throw new Error('account-changed');
          requireSession(uid);
        }
      });
      await sdk.signInWithCustomToken(auth, result.customToken);
      requireSession(uid);
    } finally {
      unguard?.();
      renewing = false;
    }
  }

  return {
    settingsAccountSecurity(uid) {
      requireSession(uid);
      let attempt;
      let smsFlow;
      let smsSignal;

      async function ownCall(name, data = {}) {
        requireSession(uid);
        const result = await call(name, data);
        requireSession(uid);
        return result;
      }

      function guard(signal) {
        requireSession(uid);
        if (signal?.aborted) throw new DOMException('Confirmation cancelled', 'AbortError');
      }

      async function phoneCall(name, data, options) {
        guard(smsSignal);
        const result = await invoke(name, data, options);
        guard(smsSignal);
        return result;
      }

      function getSmsFlow() {
        smsFlow ??= new PhoneAuthFlow({
          start: id => phoneCall('startPhoneAuth', id ? { installationId: id } : {}),
          request: payload => phoneCall('requestPhoneAuthCode', payload, replayProtected),
          verify: payload => phoneCall('verifyPhoneAuthCode', payload, replayProtected),
        }, (nonce, number, bits) => solvePow(nonce, number, bits, { signal: smsSignal }), installationId());
        return smsFlow;
      }

      async function finishEmailChange(name, data) {
        const result = await ownCall(name, data);
        await continueSession(uid, result);
        return { email: result.email, maskedEmail: result.maskedEmail };
      }

      return {
        getMethods: () => ownCall('getSignInMethods'),
        getPhoneLinkStatus: () => ownCall('getPhoneLinkStatus'),
        requestEmail: email => ownCall('requestEmailChangeCode', { email }),
        verifyEmail: (challengeId, code) => finishEmailChange('verifyEmailChangeCode', { challengeId, code }),
        resumeEmail: challengeId => finishEmailChange('resumeEmailChange', { challengeId }),
        requestPhone: (phoneE164, consentVersion) => ownCall('requestPhoneLinkOtp', {
          phoneE164, consentVersion, ownershipConfirmed: true, smsConsent: true,
        }),
        verifyPhone: (challengeId, code) => ownCall('verifyPhoneLinkOtp', { challengeId, code }),
        resumePhone: () => ownCall('resumePhoneLink'),
        async sendConfirmation(method, target, signal) {
          guard(signal);
          attempt = undefined;
          if (method === 'email' && typeof target === 'string' && emailPattern.test(target)) {
            await ownCall('requestEmailOtp', { email: target });
            guard(signal);
            attempt = { method, target };
            return {};
          }
          if (method !== 'phone' || typeof target !== 'string' || !phonePattern.test(target)) throw new Error('reauth-required');
          smsSignal = signal;
          const flow = getSmsFlow();
          const challenge = await flow.sendCode(target);
          guard(signal);
          attempt = { method, challengeId: challenge.challengeId };
          return challenge;
        },
        async verifyConfirmation(code, signal) {
          guard(signal);
          if (!attempt || typeof code !== 'string' || !pinPattern.test(code)) throw new Error('code-invalid');
          const current = attempt;
          smsSignal = signal;
          const result = current.method === 'phone'
            ? await getSmsFlow().verify(current.challengeId, code)
            : await ownCall('verifyEmailOtp', { email: current.target, code });
          guard(signal);
          if (attempt !== current || result?.uid !== uid) throw new Error('account-mismatch');
          await continueSession(uid, result);
          attempt = undefined;
          smsFlow = undefined;
        },
        async setPin(pin) {
          requireSession(uid);
          const record = await createPinRecord(pin);
          requireSession(uid);
          await sdk.setDoc(sdk.doc(db, 'users', uid, 'userPrivate', 'profile'), {
            ...record, pinSetAt: sdk.serverTimestamp(),
          }, { merge: true });
          requireSession(uid);
        },
      };
    },
  };
}
