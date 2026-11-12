import { availableCountries } from '../mobile/src/lib/countries.ts';
import { PhoneAuthFlow, phoneAuthErrorInfo } from '../mobile/src/lib/phoneAuth.flow.ts';
import { solvePow } from '../mobile/src/lib/sha256.ts';

const INSTALLATION_KEY = 'offlinesms.web.installationId';

// Like the mobile app, keep only the random installation signal. The session,
// challenge, phone number and verification code are never persisted here.
function installationId() {
  try {
    const previous = localStorage.getItem(INSTALLATION_KEY);
    if (previous && /^[A-Za-z0-9_-]{16,64}$/.test(previous)) return previous;
    const id = crypto.randomUUID();
    localStorage.setItem(INSTALLATION_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export function createPhoneAuthClient({ invoke, signIn, isSignedIn, useAppCheck }) {
  let countries = [];
  let current = null;
  const limitedUse = useAppCheck ? { limitedUseAppCheckTokens: true } : undefined;

  function resetPhoneFlow() {
    current?.operation?.abort();
    current = null;
  }

  function activeSignal(attempt) {
    if (attempt !== current || !attempt.operation || attempt.operation.signal.aborted || isSignedIn()) {
      throw new DOMException('Phone authentication cancelled', 'AbortError');
    }
    return attempt.operation.signal;
  }

  function createAttempt() {
    const attempt = { operation: null, phone: null, challengeId: null, flow: null };

    async function invokeForAttempt(name, payload, options) {
      activeSignal(attempt);
      const result = await invoke(name, payload, options);
      activeSignal(attempt);
      return result;
    }

    attempt.flow = new PhoneAuthFlow({
      start: async id => {
        const result = await invokeForAttempt('startPhoneAuth', id ? { installationId: id } : {});
        if (!result?.pow || result.pow.expiresAtMs <= Date.now()) throw new Error('session-expired');
        return result;
      },
      request: payload => invokeForAttempt('requestPhoneAuthCode', payload, limitedUse),
      verify: payload => invokeForAttempt('verifyPhoneAuthCode', payload, limitedUse),
    }, async (nonce, number, bits) => {
      const proof = await solvePow(nonce, number, bits, { signal: activeSignal(attempt) });
      activeSignal(attempt);
      return proof;
    }, installationId());
    return attempt;
  }

  async function run(attempt, signal, operation) {
    if (attempt.operation) throw new Error('service-busy');
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    attempt.operation = controller;
    try {
      activeSignal(attempt);
      return await operation();
    } finally {
      signal?.removeEventListener('abort', abort);
      attempt.operation = null;
    }
  }

  return {
    async getPhoneAvailability() {
      const result = await invoke('getSupportedPhoneCountries', { v: 2 });
      const codes = Array.isArray(result?.countries) ? result.countries.filter(code => typeof code === 'string') : [];
      countries = result?.available === true ? availableCountries(codes) : [];
      return { available: countries.length > 0, countries: countries.map(country => ({ ...country })) };
    },
    async requestPhoneCode(phone, { reset = false, signal } = {}) {
      if (isSignedIn() || !/^\+[1-9][0-9]{6,14}$/.test(phone) || !countries.some(country => phone.startsWith(country.dial))) {
        throw new Error('number-not-supported');
      }
      if (reset) resetPhoneFlow();
      if (!current) current = createAttempt();
      const attempt = current;
      if (attempt.phone && attempt.phone !== phone) throw new Error('request-conflict');
      attempt.phone = phone;
      return run(attempt, signal, async () => {
        const result = await attempt.flow.sendCode(phone);
        activeSignal(attempt);
        if (typeof result?.challengeId !== 'string' || !result.challengeId) throw new Error('signin-interrupted');
        attempt.challengeId = result.challengeId;
        return { challengeId: result.challengeId, maskedPhone: result.maskedPhone, resendAfterSec: result.resendAfterSec };
      });
    },
    async verifyPhoneCode(challengeId, code, { signal } = {}) {
      const attempt = current;
      if (!attempt?.challengeId || challengeId !== attempt.challengeId) throw new Error('challenge-not-found');
      if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new Error('code-invalid');
      return run(attempt, signal, async () => {
        const result = await attempt.flow.verify(challengeId, code);
        activeSignal(attempt);
        if (typeof result?.customToken !== 'string' || !result.customToken) throw new Error('signin-interrupted');
        await signIn(result.customToken);
        if (current === attempt) resetPhoneFlow();
        return { isNewUser: result.isNewUser === true };
      });
    },
    resetPhoneFlow,
    phoneErrorInfo: phoneAuthErrorInfo,
  };
}
