import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { readUserPhone } from '../lib/userPrivate';
import { calculateSmsMetrics, composeSmsBody, SMS_POINTS_PER_SEGMENT, type SmsFormatSettings } from './messageFormat';

export interface SmsContentContext {
  settings: SmsFormatSettings; senderPhone: string | null; groupName?: string | null;
}

/** Resolve one immutable policy/identity snapshot for a whole personalized batch. */
export async function loadSmsContentContext(db: Firestore, context: {
  senderUid?: string; groupName?: string | null;
}): Promise<SmsContentContext> {
  const settings = (await db.doc('systemSettings/general').get()).data() ?? {};
  let senderPhone: string | null = null;
  if (settings.smsShowSenderPhone === true && context.senderUid) {
    const sender = await db.collection('users').doc(context.senderUid).get();
    if (sender.get('phoneVerified') === true) senderPhone = await readUserPhone(db, context.senderUid);
  }
  return { settings, senderPhone, groupName: context.groupName };
}

export function prepareSmsContentWithContext(body: string, context: SmsContentContext) {
  const finalSmsBody = composeSmsBody(body, context.settings, context);
  const metrics = calculateSmsMetrics(finalSmsBody);
  return {
    finalSmsBody, ...metrics,
    pointsPerRecipient: metrics.smsSegments * SMS_POINTS_PER_SEGMENT,
    smsPricingVersion: 1 as const,
  };
}

/** Resolve branding and identity exclusively from trusted server-owned data. */
export async function prepareSmsContent(db: Firestore, context: {
  body: string; senderUid?: string; groupName?: string | null;
}) {
  return prepareSmsContentWithContext(context.body, await loadSmsContentContext(db, context));
}

/** A change detector, not an authorization credential. Sending always rechecks
 * permissions and computes pricing server-side; clients cannot set the price. */
export function smsQuoteToken(context: {
  uid: string; conversationId: string; messageId: string; audience: string;
  finalSmsBody: string; pointsPerRecipient: number;
  recipients: Array<{ uid: string; phone: string }>;
}): string {
  const { uid, conversationId, messageId, audience, finalSmsBody, pointsPerRecipient, recipients } = context;
  return createHash('sha256').update(JSON.stringify({
    uid, conversationId, messageId, audience, finalSmsBody, pointsPerRecipient, recipients: recipients.map(r => [r.uid, r.phone]).sort((a, b) => a[0].localeCompare(b[0])),
  })).digest('hex');
}
