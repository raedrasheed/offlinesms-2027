// OfflineSMS Gateway — mock implementation
// Replace `sendBatch` with a real provider call when ready. The rest of the
// system never sees the provider name; we always present "OfflineSMS Gateway".
import { logger } from 'firebase-functions';

export type SmsRecipient = { uid: string; phone: string; maskedPhone: string };
export type SmsBatchResult = {
  gatewayBatchId: string;
  acceptedRecipientIds: string[];
  rejectedRecipientIds: { uid: string; reason: string }[];
};

export async function sendBatch(
  batchId: string,
  body: string,
  recipients: SmsRecipient[],
): Promise<SmsBatchResult> {
  logger.info(`[OfflineSMS Gateway] dispatch batch=${batchId} n=${recipients.length}`);

  // Simulate: 90% delivered, 10% failed
  const accepted: string[] = [];
  const rejected: { uid: string; reason: string }[] = [];
  for (const r of recipients) {
    if (Math.random() < 0.9) accepted.push(r.uid);
    else rejected.push({ uid: r.uid, reason: 'Gateway: number unreachable' });
  }

  // Simulate provider latency
  await new Promise(r => setTimeout(r, 400));

  return {
    gatewayBatchId: `OSMS-${batchId.slice(0, 8)}`,
    acceptedRecipientIds: accepted,
    rejectedRecipientIds: rejected,
  };
}
