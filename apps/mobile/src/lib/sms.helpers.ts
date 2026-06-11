// Pure helpers extracted from sms.ts so they can be unit-tested
// without pulling in firebase. sms.ts re-exports them.

export type SmsSkipReason =
  | 'no-phone' | 'unverified-phone' | 'opt-out'
  | 'duplicate-phone' | 'already-sent-for-message'
  | 'rate-limited' | 'policy-blocked';

export function smsErrorCopy(code: string): string {
  switch (code) {
    case 'functions/resource-exhausted':
    case 'resource-exhausted':
      return 'Daily SMS limit reached. Try again tomorrow.';
    case 'functions/failed-precondition':
    case 'failed-precondition':
      return 'This SMS can’t be sent right now.';
    case 'functions/permission-denied':
    case 'permission-denied':
      return 'You don’t have permission to send this SMS.';
    case 'functions/invalid-argument':
    case 'invalid-argument':
      return 'Please review the values and try again.';
    case 'functions/not-found':
    case 'not-found':
      return 'Not found.';
    default:
      return 'Couldn’t send via OfflineSMS. Please try again.';
  }
}

export function smsErrorReason(err: unknown): string | null {
  const msg = (err as { message?: string })?.message ?? '';
  if (!msg) return null;
  return msg.includes(':') ? msg.split(':')[0] : msg;
}

export function smsSkipReasonCopy(reason: SmsSkipReason): string {
  switch (reason) {
    case 'no-phone':                  return 'No phone number';
    case 'unverified-phone':          return 'Phone not verified';
    case 'opt-out':                   return 'SMS opted out';
    case 'duplicate-phone':           return 'Duplicate phone number';
    case 'already-sent-for-message':  return 'Already received SMS for this message';
    case 'rate-limited':              return 'Rate limit reached';
    case 'policy-blocked':            return 'Blocked by policy';
  }
}

/** Default SMS body for an escalation = the original message text, which the
 *  sender can edit before sending. Capped at the 320-char smsBody limit. */
export function buildDefaultSmsBody(messageText: string | null | undefined): string {
  const raw = (messageText ?? '').replace(/\s+/g, ' ').trim();
  const cap = 320;
  return raw.length > cap ? raw.slice(0, cap - 1) + '…' : raw;
}
