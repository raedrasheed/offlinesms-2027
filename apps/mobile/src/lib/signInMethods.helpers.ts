// Pure helpers for Settings → sign-in methods and the email add/change flow —
// no Firebase / RN imports, so they are unit-testable
// (apps/mobile/__tests__/signInMethods.test.ts).

/** Server error code (HttpsError.message) → i18n key under `emailChange.errors`. */
const ERROR_KEYS: Record<string, string> = {
  'auth-required': 'signedOut',
  'reauth-required': 'reauthRequired',
  'email-not-verified': 'noVerifiedMethod',
  'email-account-required': 'noVerifiedMethod',
  'account-disabled': 'accountDisabled',
  'not-allowed': 'accountDisabled',
  'email-change-disabled': 'unavailable',
  'email-invalid': 'emailInvalid',
  'email-send-failed': 'sendFailed',
  'email-unavailable': 'emailUnavailable',
  'already-linked': 'alreadyLinked',
  'change-pending-recovery': 'pendingRecovery',
  'change-interrupted': 'interrupted',
  'cooldown': 'cooldown',
  'rate-limited': 'rateLimited',
  'too-many-numbers': 'tooManyAddresses',
  'code-invalid': 'codeInvalid',
  'code-expired': 'codeExpired',
  'too-many-attempts': 'tooManyAttempts',
  'challenge-not-found': 'codeExpired',
  'purpose-invalid': 'generic',
  'account-mismatch': 'generic',
  // Re-authentication with an emailed sign-in code (requestEmailOtp/verifyEmailOtp).
  'email-signin-disabled': 'unavailable',
  'otp-cooldown': 'cooldownShort',
  'otp-rate-limited': 'rateLimitedShort',
  'otp-not-requested': 'codeExpired',
  'otp-expired': 'codeExpired',
  'otp-too-many-attempts': 'tooManyAttempts',
  'otp-incorrect': 'codeInvalidShort',
};

export interface EmailChangeErrorInfo {
  key: string;
  retryAfterSec?: number;
  attemptsLeft?: number;
  needsReauth: boolean;
  canResume: boolean;
}

export function emailChangeErrorInfo(e: unknown): EmailChangeErrorInfo {
  const err = e as { message?: unknown; code?: unknown; details?: unknown } | null;
  const code = typeof err?.message === 'string' && err.message in ERROR_KEYS ? err.message : '';
  const network = err?.code === 'functions/unavailable' || err?.code === 'functions/deadline-exceeded';
  const k = code ? ERROR_KEYS[code] : (network ? 'network' : 'generic');
  const d = (err?.details ?? {}) as { retryAfterSec?: unknown; attemptsLeft?: unknown };
  return {
    key: `emailChange.errors.${k}`,
    retryAfterSec: typeof d.retryAfterSec === 'number' ? d.retryAfterSec : undefined,
    attemptsLeft: typeof d.attemptsLeft === 'number' ? d.attemptsLeft : undefined,
    needsReauth: code === 'reauth-required',
    canResume: code === 'change-interrupted' || code === 'change-pending-recovery',
  };
}

export type MethodAction = 'add' | 'edit';
export interface MethodRow { kind: 'email' | 'phone'; value: string | null; action: MethodAction }

/**
 * Settings always shows BOTH methods: the one the account has reads "Edit",
 * the missing one reads "Add" — for email- and phone-registered accounts alike.
 * Values come from the server's view of the account when known, else from the
 * local Auth user.
 */
export function signInMethodRows(
  server: { email: string | null; phone: string | null } | null,
  local: { email?: string | null; phoneNumber?: string | null },
): MethodRow[] {
  const email = (server ? server.email : local.email) ?? null;
  const phone = (server ? server.phone : local.phoneNumber) ?? null;
  return [
    { kind: 'email', value: email, action: email ? 'edit' : 'add' },
    { kind: 'phone', value: phone, action: phone ? 'edit' : 'add' },
  ];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isPlausibleEmail(s: string): boolean {
  const t = (s ?? '').trim();
  return t.length > 0 && t.length <= 254 && EMAIL_RE.test(t);
}

/** Show a phone number LTR with a thin grouping, e.g. "+970 599 123 456". */
export function formatOwnPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+(\d{3})(\d{3})(\d{3})(\d+)$/.exec(e164);
  return m ? `+${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}
