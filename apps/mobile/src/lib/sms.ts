// OfflineSMS escalation client.
//
// Thin wrappers over the Phase 8 callables. Phone numbers stay masked at
// the boundary — the unmasked phone never leaves the server. Every
// callable surfaces a friendly error code via smsErrorCopy().

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';

export type EscalationAudience = 'everyone' | 'unread_only' | 'undelivered_only';

export type SmsAppReceiptStatus =
  | 'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed' | null;

export type SmsSkipReason =
  | 'no-phone' | 'unverified-phone' | 'opt-out'
  | 'duplicate-phone' | 'already-sent-for-message'
  | 'rate-limited' | 'policy-blocked';

export type EligibleRecipient = {
  uid:              string;
  displayName:      string | null;
  maskedPhone:      string;
  appReceiptStatus: SmsAppReceiptStatus;
};

export type ExcludedRecipient = {
  uid:              string;
  displayName:      string | null;
  appReceiptStatus: SmsAppReceiptStatus;
  skipReason:       SmsSkipReason;
};

export type EscalationPreview = {
  audience:            EscalationAudience;
  eligibleRecipients:  EligibleRecipient[];
  excludedRecipients:  ExcludedRecipient[];
  eligibleCount:       number;
  excludedCount:       number;
  pointsCost:          number;
  costPerSms:          number;
  walletBalance:       number;
  walletReserved:      number;
  audienceCap:         number;
  exceedsCap:          boolean;
};

export type EscalationResult = {
  batchId:           string;
  offlineSmsBatchId: string | null;
  sent:              number;
  failed:            number;
  skipped:           number;
  pointsCost:        number;
  status:            'accepted' | 'partial' | 'failed';
};

function fn<T = unknown, R = unknown>(name: string) {
  return httpsCallable<T, R>(getFunctions(app), name);
}

export async function previewSmsEscalation(args: {
  conversationId: string;
  messageId:      string;
  audience:       EscalationAudience;
}): Promise<EscalationPreview> {
  const res = await fn<typeof args, EscalationPreview>('previewSmsEscalation')(args);
  return res.data;
}

export async function escalateSms(args: {
  conversationId: string;
  messageId:      string;
  audience:       EscalationAudience;
  smsBody:        string;
}): Promise<EscalationResult> {
  const res = await fn<typeof args, EscalationResult>('escalateSms')(args);
  return res.data;
}

export async function retryFailedSmsRecipients(batchId: string): Promise<{
  batchId: string; retryOf: string; sent: number; failed: number; status: string;
}> {
  const res = await fn<{ batchId: string }, { batchId: string; retryOf: string; sent: number; failed: number; status: string }>(
    'retryFailedSmsRecipients',
  )({ batchId });
  return res.data;
}

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

export function buildDefaultSmsBody(conversationName: string | null | undefined, messageText: string | null | undefined): string {
  const name = (conversationName ?? '').trim() || 'OfflineSMS';
  const raw  = (messageText ?? '').replace(/\s+/g, ' ').trim();
  // SMS soft cap 160 GSM-7 chars; keep an excerpt that leaves room for the
  // surrounding sentence. Phase 8 caps total smsBody at 320 chars.
  const excerptCap = 120;
  const excerpt = raw.length > excerptCap ? raw.slice(0, excerptCap - 1) + '…' : raw;
  return `OfflineSMS reminder from ${name}: ${excerpt} Open OfflineSMS to view the full message.`;
}
