// Client orchestration for protected public phone sign-in / sign-up. Pure:
// the network calls and the proof-of-work solver are injected, so this is unit
// tested without Firebase (apps/mobile/__tests__/phoneAuth.test.ts). Every rule
// is enforced by the server; this only follows the protocol:
//
//   startPhoneAuth → (solve proof for the number) → requestPhoneAuthCode
//   → verifyPhoneAuthCode → custom token
//
// A lost response is retried with the SAME requestId (the server returns the
// original result instead of sending again). A refused request hands back a
// fresh proof challenge, which replaces the consumed one.

export interface PowChallenge { nonce: string; bits: number; expiresAtMs: number }
export interface StartResult { sessionToken: string; expiresAtMs: number; pow: PowChallenge }
export interface CodeResult {
  challengeId: string; expiresAtMs: number; resendAfterSec: number; maskedPhone: string; pow: PowChallenge;
}
export interface VerifyResult { customToken: string; uid: string; isNewUser: boolean }

export interface PhoneAuthApi {
  start(installationId: string | null): Promise<StartResult>;
  request(p: { sessionToken: string; phoneE164: string; powNonce: string; powSolution: string; requestId: string }): Promise<CodeResult>;
  verify(p: { sessionToken: string; challengeId: string; code: string }): Promise<VerifyResult>;
}

export type Solver = (nonce: string, e164: string, bits: number) => Promise<string>;

interface ErrLike { message?: unknown; code?: unknown; details?: unknown }

export function errCode(e: unknown): string {
  const m = (e as ErrLike | null)?.message;
  return typeof m === 'string' ? m : '';
}

function errPow(e: unknown): PowChallenge | null {
  const p = ((e as ErrLike | null)?.details as { pow?: PowChallenge } | undefined)?.pow;
  return p && typeof p.nonce === 'string' && typeof p.bits === 'number' ? p : null;
}

/** Server error code → i18n key under `phoneAuth.errors`. */
const KEYS: Record<string, string> = {
  'phone-auth-unavailable': 'unavailable',
  'app-update-required': 'unavailable',
  'service-paused': 'servicePaused',
  'service-busy': 'serviceBusy',
  'attestation-required': 'unavailable',
  'number-not-supported': 'numberNotSupported',
  'no-relay-for-country': 'countryUnavailable',
  'session-expired': 'sessionExpired',
  'session-exhausted': 'sessionExhausted',
  'proof-invalid': 'generic',
  'request-conflict': 'generic',
  'request-invalid': 'generic',
  'purpose-invalid': 'generic',
  'cooldown': 'cooldown',
  'rate-limited': 'rateLimited',
  'too-many-numbers': 'tooManyNumbers',
  'challenge-not-found': 'codeExpired',
  'code-invalid': 'codeInvalid',
  'code-expired': 'codeExpired',
  'too-many-attempts': 'tooManyAttempts',
  'account-disabled': 'accountDisabled',
  'signin-interrupted': 'interrupted',
};

const TRANSPORT_CODES = new Set(['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded']);

/** A failure with no server verdict (network loss, timeout, crash) — the
 *  request may or may not have been applied, so it is retried idempotently. */
function isTransport(e: unknown): boolean {
  const c = (e as ErrLike | null)?.code;
  return typeof c === 'string' && TRANSPORT_CODES.has(c) && !(errCode(e) in KEYS);
}

export function newRequestId(rand: () => number = Math.random): string {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let s = '';
  for (let i = 0; i < 24; i++) s += a[Math.floor(rand() * a.length)];
  return s;
}

export class PhoneAuthFlow {
  private session: StartResult | null = null;

  constructor(
    private api: PhoneAuthApi,
    private solve: Solver,
    private installationId: string | null,
    private now: () => number = Date.now,
  ) {}

  get sessionToken(): string | null { return this.session?.sessionToken ?? null; }

  private async ensureSession(): Promise<StartResult> {
    if (!this.session || this.session.expiresAtMs - 30_000 <= this.now()) {
      this.session = await this.api.start(this.installationId);
    }
    return this.session;
  }

  /**
   * Request a code for `phoneE164`. Retries at most once on a refreshable
   * condition (expired session / consumed proof) and once on a lost response
   * (same requestId ⇒ the server never sends twice).
   */
  async sendCode(phoneE164: string): Promise<CodeResult> {
    let renewedSession = false;
    let refreshedProof = false;
    for (;;) {
      const sess = await this.ensureSession();
      if (sess.pow.expiresAtMs <= this.now()) { this.session = null; continue; }
      const powSolution = await this.solve(sess.pow.nonce, phoneE164, sess.pow.bits);
      const req = { sessionToken: sess.sessionToken, phoneE164, powNonce: sess.pow.nonce, powSolution, requestId: newRequestId() };
      try {
        let res: CodeResult;
        try { res = await this.api.request(req); }
        catch (e) { if (!isTransport(e)) throw e; res = await this.api.request(req); }
        sess.pow = res.pow;
        return res;
      } catch (e) {
        const fresh = errPow(e);
        if (fresh) sess.pow = fresh;
        const c = errCode(e);
        if ((c === 'session-expired' || c === 'session-exhausted') && !renewedSession) {
          renewedSession = true; this.session = null; continue;
        }
        if (c === 'proof-invalid' && fresh && !refreshedProof) { refreshedProof = true; continue; }
        throw e;
      }
    }
  }

  async verify(challengeId: string, code: string): Promise<VerifyResult> {
    const token = this.session?.sessionToken;
    if (!token) throw Object.assign(new Error('session-expired'), { code: 'functions/failed-precondition' });
    try { return await this.api.verify({ sessionToken: token, challengeId, code }); }
    catch (e) {
      // A lost response after the code was accepted: retrying is idempotent.
      if (isTransport(e) || errCode(e) === 'signin-interrupted') {
        return this.api.verify({ sessionToken: token, challengeId, code });
      }
      throw e;
    }
  }
}

export function phoneAuthErrorInfo(e: unknown): { key: string; retryAfterSec?: number; attemptsLeft?: number } {
  const c = errCode(e);
  const d = ((e as ErrLike | null)?.details ?? {}) as { retryAfterSec?: unknown; attemptsLeft?: unknown };
  const k = KEYS[c] ?? (isTransport(e) || c === '' ? 'network' : 'generic');
  return {
    key: `phoneAuth.errors.${k}`,
    retryAfterSec: typeof d.retryAfterSec === 'number' && d.retryAfterSec > 0 ? d.retryAfterSec : undefined,
    attemptsLeft: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : undefined,
  };
}
