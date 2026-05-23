// Shared helpers for resolving SMS escalation recipients from Phase 7
// receipt data, honouring per-user eligibility (phone presence,
// verification, opt-out, duplicates).

import type { Firestore, DocumentSnapshot } from 'firebase-admin/firestore';

export type AudienceWire = 'everyone' | 'unread_only' | 'undelivered_only';

/** Accepts the canonical Phase 8 names AND the legacy Phase 0 names. */
export type AudienceInput = AudienceWire | 'unread' | 'undelivered';

export function canonicalAudience(input: AudienceInput): AudienceWire {
  if (input === 'unread')       return 'unread_only';
  if (input === 'undelivered')  return 'undelivered_only';
  return input;
}

export type SkipReason =
  | 'no-phone'
  | 'unverified-phone'
  | 'opt-out'
  | 'duplicate-phone'
  | 'already-sent-for-message'
  | 'rate-limited'
  | 'policy-blocked';

export type Eligible = {
  uid:              string;
  phone:            string;
  maskedPhone:      string;
  displayName:      string | null;
  appReceiptStatus: string | null;
};

export type Excluded = {
  uid:              string;
  displayName:      string | null;
  appReceiptStatus: string | null;
  skipReason:       SkipReason;
};

export function maskPhone(p: string): string {
  if (!p) return '';
  if (p.length < 6) return p;
  return p.slice(0, 4) + ' ••• ' + p.slice(-3);
}

/**
 * Decide which conversation participants the escalation should target,
 * given the receipts on the original message.
 *
 *   everyone           → all participants except the sender
 *   unread_only        → participants whose status is not in
 *                        {read, viewed, played}
 *   undelivered_only   → participants whose status is pending/failed
 *                        OR who have no receipt doc
 */
export function filterByAudience(
  audience: AudienceWire,
  participantUids: string[],
  senderUid: string,
  receiptsByUid: Map<string, { status?: string }>,
): { candidates: Array<{ uid: string; appReceiptStatus: string | null }> } {
  const candidates: Array<{ uid: string; appReceiptStatus: string | null }> = [];
  for (const uid of participantUids) {
    if (uid === senderUid) continue;
    const status = receiptsByUid.get(uid)?.status ?? null;
    if (audience === 'everyone') {
      candidates.push({ uid, appReceiptStatus: status });
      continue;
    }
    if (audience === 'unread_only') {
      const read = status === 'read' || status === 'viewed' || status === 'played';
      if (!read) candidates.push({ uid, appReceiptStatus: status });
      continue;
    }
    if (audience === 'undelivered_only') {
      const undelivered = !status || status === 'pending' || status === 'failed';
      if (undelivered) candidates.push({ uid, appReceiptStatus: status });
      continue;
    }
  }
  return { candidates };
}

/**
 * Per-recipient eligibility — produces split eligible / excluded lists
 * from a candidate set. Reads /users/{uid} for phone + opt-out status.
 *
 * Duplicate-phone detection runs after individual eligibility so the
 * earliest uid in the list keeps the phone and later duplicates are
 * skipped with 'duplicate-phone'.
 */
export async function classifyRecipients(
  db: Firestore,
  candidates: Array<{ uid: string; appReceiptStatus: string | null }>,
  alreadySentUids?: ReadonlySet<string>,
): Promise<{ eligible: Eligible[]; excluded: Excluded[] }> {
  const eligible: Eligible[] = [];
  const excluded: Excluded[] = [];

  const userSnaps = await Promise.all(
    candidates.map(c => db.collection('users').doc(c.uid).get()),
  );
  const seenPhones = new Set<string>();

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];

    // Phase 11 cross-batch dedupe: skip recipients who already have
    // a non-failed SMS for the same originating message.
    if (alreadySentUids?.has(c.uid)) {
      excluded.push({
        uid: c.uid, displayName: null,
        appReceiptStatus: c.appReceiptStatus,
        skipReason: 'already-sent-for-message',
      });
      continue;
    }

    const snap: DocumentSnapshot = userSnaps[i];
    if (!snap.exists) {
      excluded.push({ uid: c.uid, displayName: null, appReceiptStatus: c.appReceiptStatus, skipReason: 'no-phone' });
      continue;
    }
    const u = snap.data() as {
      displayName?: string;
      phoneNumber?: string | null;
      phoneVerified?: boolean;
      smsOptOut?: boolean;
    };
    const displayName = u.displayName ?? null;
    const phone = u.phoneNumber ?? null;

    if (u.smsOptOut === true) {
      excluded.push({ uid: c.uid, displayName, appReceiptStatus: c.appReceiptStatus, skipReason: 'opt-out' });
      continue;
    }
    if (!phone) {
      excluded.push({ uid: c.uid, displayName, appReceiptStatus: c.appReceiptStatus, skipReason: 'no-phone' });
      continue;
    }
    // phoneVerified is treated as truthy-by-default for Phase 8 because
    // the onboarding flow doesn't yet set the flag. Once Phase 2's flow
    // owns it explicitly, this branch tightens to require === true.
    if (u.phoneVerified === false) {
      excluded.push({ uid: c.uid, displayName, appReceiptStatus: c.appReceiptStatus, skipReason: 'unverified-phone' });
      continue;
    }
    if (seenPhones.has(phone)) {
      excluded.push({ uid: c.uid, displayName, appReceiptStatus: c.appReceiptStatus, skipReason: 'duplicate-phone' });
      continue;
    }
    seenPhones.add(phone);
    eligible.push({
      uid: c.uid,
      phone,
      maskedPhone: maskPhone(phone),
      displayName,
      appReceiptStatus: c.appReceiptStatus,
    });
  }

  return { eligible, excluded };
}

/**
 * Phase 11 cross-batch dedupe lookup. Returns the set of recipient uids
 * who have at least one non-failed (queued/sent/delivered) SMS row for
 * the (messageId, senderUid) pair across all prior batches.
 */
export async function findAlreadySentUids(
  db: Firestore,
  senderUid: string,
  messageId: string,
): Promise<Set<string>> {
  const out = new Set<string>();
  // Index: smsBatches(senderId, messageId, createdAt DESC) — Phase 11.
  const batches = await db.collection('smsBatches')
    .where('senderId',  '==', senderUid)
    .where('messageId', '==', messageId)
    .limit(50)
    .get();
  if (batches.empty) return out;
  for (const b of batches.docs) {
    const recipients = await b.ref.collection('recipients').get();
    for (const r of recipients.docs) {
      const status = r.get('smsStatus') as string | undefined;
      if (status === 'queued' || status === 'sent' || status === 'delivered') {
        out.add(r.id);
      }
    }
  }
  return out;
}

export const MAX_BATCHES_PER_DAY     = 20;
export const MAX_RECIPIENTS_PER_BATCH = 200;
export const COOLDOWN_MS              = 60_000;
export const COST_PER_SMS             = 28;

/** UTC yyyymmdd. */
export function todayKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}
