// Organization Messaging — pure escalation helpers (no Firestore), mirroring
// the OfflineSMS app's escalation semantics in sms/recipients.ts:
//   everyone          → every recipient with an in-app message
//   unread_only       → receipt not yet read/viewed/played
//   undelivered_only  → receipt missing/pending/failed
// Unit-tested in isolation; the scheduled sweeper adds only Firestore I/O.

export type OrgEscalationAudience = 'unread_only' | 'undelivered_only' | 'everyone';

export const SMS_TEXT_MAX = 320;   // matches the app's escalateSms cap

const READ_STATUSES      = new Set(['read', 'viewed', 'played']);
const DELIVERED_STATUSES = new Set(['delivered', ...READ_STATUSES]);

/** Map a receipt status onto the org-message row status (receipt-backed). */
export function receiptToRowStatus(receipt: string | undefined | null): 'queued' | 'delivered' | 'read' {
  if (receipt && READ_STATUSES.has(receipt)) return 'read';
  if (receipt && DELIVERED_STATUSES.has(receipt)) return 'delivered';
  return 'queued';
}

/** Whether a recipient with this receipt status falls into the SMS audience. */
export function audienceIncludes(
  audience: OrgEscalationAudience,
  receipt: string | undefined | null,
): boolean {
  if (audience === 'everyone') return true;
  if (audience === 'unread_only') return !(receipt && READ_STATUSES.has(receipt));
  // undelivered_only — pending/failed/missing receipts.
  return !receipt || receipt === 'pending' || receipt === 'failed';
}

/** SMS text for one recipient: "title: body", capped at the gateway limit. */
export function composeSmsText(title: string, body: string): string {
  const raw = `${title}: ${body}`.replace(/\s+/g, ' ').trim();
  return raw.length > SMS_TEXT_MAX ? raw.slice(0, SMS_TEXT_MAX - 1) + '…' : raw;
}

/**
 * Group rows by identical SMS text. Shape A produces one group; shape B
 * (per-recipient bodies) produces one gateway batch per distinct text.
 */
export function groupBySmsText<T extends { smsText: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const list = groups.get(r.smsText);
    if (list) list.push(r);
    else groups.set(r.smsText, [r]);
  }
  return groups;
}

/** A batch is due when its escalateAt has passed. */
export function escalationDue(escalateAtMs: number, nowMs: number): boolean {
  return escalateAtMs > 0 && escalateAtMs <= nowMs;
}
