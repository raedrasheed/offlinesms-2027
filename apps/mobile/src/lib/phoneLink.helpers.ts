// Pure helpers for the "Add phone number" flow — no Firebase / RN imports so
// they are unit-testable (apps/mobile/__tests__/phoneLink.test.ts).

/** Server error code (HttpsError.message) → i18n key under `phoneLink.errors`. */
const ERROR_KEYS: Record<string, string> = {
  'auth-required': 'signedOut',
  'reauth-required': 'reauthRequired',
  'email-not-verified': 'emailNotVerified',
  'email-account-required': 'emailNotVerified',
  'account-disabled': 'accountDisabled',
  'not-allowed': 'accountDisabled',
  'phone-link-disabled': 'unavailable',
  'service-paused': 'servicePaused',
  'service-busy': 'serviceBusy',
  'consent-required': 'consentRequired',
  'number-not-supported': 'numberNotSupported',
  'no-relay-for-country': 'countryUnavailable',
  'phone-unavailable': 'numberUnavailable',
  'already-linked': 'alreadyLinked',
  'link-pending-recovery': 'pendingRecovery',
  'link-interrupted': 'interrupted',
  'cooldown': 'cooldown',
  'rate-limited': 'rateLimited',
  'too-many-numbers': 'tooManyNumbers',
  'code-invalid': 'codeInvalid',
  'code-expired': 'codeExpired',
  'too-many-attempts': 'tooManyAttempts',
  'challenge-not-found': 'codeExpired',
  'purpose-invalid': 'generic',
};

export interface PhoneLinkErrorInfo {
  /** i18n key, e.g. `phoneLink.errors.cooldown`. */
  key: string;
  /** Seconds until a retry is allowed (cooldowns / limits), when known. */
  retryAfterSec?: number;
  /** Code attempts left (wrong code), when known. */
  attemptsLeft?: number;
  /** The flow should send the user back to re-authenticate. */
  needsReauth: boolean;
  /** The flow should offer "Finish adding your number" (resume). */
  canResume: boolean;
}

/** Map a callable error to user-facing copy metadata. Never exposes raw text. */
export function phoneLinkErrorInfo(e: unknown): PhoneLinkErrorInfo {
  const err = e as { message?: unknown; code?: unknown; details?: unknown } | null;
  // The Functions SDK puts the server's HttpsError message (our stable code)
  // in `message`; anything unrecognised falls back to network/generic copy.
  const code = typeof err?.message === 'string' && err.message in ERROR_KEYS ? err.message : '';
  const k = code ? ERROR_KEYS[code] : (isNetworkError(err?.code) ? 'network' : 'generic');
  const d = (err?.details ?? {}) as { retryAfterSec?: unknown; attemptsLeft?: unknown };
  return {
    key: `phoneLink.errors.${k}`,
    retryAfterSec: typeof d.retryAfterSec === 'number' ? d.retryAfterSec : undefined,
    attemptsLeft: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : undefined,
    needsReauth: code === 'reauth-required',
    canResume: code === 'link-interrupted' || code === 'link-pending-recovery',
  };
}

function isNetworkError(code: unknown): boolean {
  return code === 'functions/unavailable' || code === 'functions/deadline-exceeded';
}

/** Build E.164 from a dial code ("+970") and locally typed digits ("0599…"). */
export function toE164(dial: string, local: string): string {
  const digits = (local ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return `${dial}${digits}`;
}

/** Human "m:ss" for a countdown. */
export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
