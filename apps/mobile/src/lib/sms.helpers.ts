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

/**
 * Reason-aware copy for the escalation flow. A bare 'functions/not-found'
 * code is ambiguous: HttpsError('not-found', 'message-not-found') from the
 * callable carries its reason in the message, while a missing/undeployed
 * callable returns code not-found with no specific reason. Distinguish so
 * the user isn't shown a useless "Not found.".
 */
export function smsPreviewErrorCopy(err: unknown): string {
  const code = (err as { code?: string })?.code ?? 'internal';
  const reason = smsErrorReason(err);
  if (reason === 'message-not-found') {
    return 'This message hasn’t reached the server yet. Wait a moment and try again.';
  }
  if (reason === 'conversation-not-found') {
    return 'This conversation isn’t available on the server.';
  }
  if (code === 'functions/not-found' || code === 'not-found') {
    return 'The OfflineSMS service isn’t available right now. Please try again later.';
  }
  return smsErrorCopy(code);
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
