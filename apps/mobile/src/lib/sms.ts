// OfflineSMS escalation client.
//
// Thin wrappers over the Phase 8 callables. Phone numbers stay masked at
// the boundary — the unmasked phone never leaves the server. Every
// callable surfaces a friendly error code via smsErrorCopy().

import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';
import {
  smsErrorCopy,
  smsErrorReason,
  smsSkipReasonCopy,
  buildDefaultSmsBody,
  type SmsSkipReason,
} from './sms.helpers';

// Re-export pure helpers so existing imports keep working.
export {
  smsErrorCopy,
  smsErrorReason,
  smsSkipReasonCopy,
  buildDefaultSmsBody,
};
export type { SmsSkipReason };

export type EscalationAudience = 'everyone' | 'unread_only' | 'undelivered_only';

export type SmsAppReceiptStatus =
  | 'pending' | 'delivered' | 'read' | 'viewed' | 'played' | 'failed' | null;

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

