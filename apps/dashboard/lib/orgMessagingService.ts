// Organization Messaging — the ONE submission path shared by the public API
// route and the dashboard server action.
//
// Flow: resolve recipients → quota transaction (org status + monthly limit) →
// create REAL in-app conversation messages from the organization's system
// sender to each registered recipient (the existing onMessageCreate trigger
// fans out receipts; the mobile app — unmodified — delivers and reports
// delivered/read) → per-recipient logs → schedule SMS escalation per the
// org's policy (the functions/ sweeper escalates unread/undelivered to SMS
// after the configured delay, billed to the org's points wallet).
//
// Statuses are receipt-backed truths: queued (created, receipt pending),
// delivered / read (reported by the recipient's device), failed,
// unsupported_recipient. Never guessed.
//
// SECURITY: this runs with the Admin SDK, which BYPASSES Firestore rules.
// Callers must do their own authorization first (API route: bearer-key auth;
// dashboard action: session + capability + org scope).

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { loadOrgRelayCoverage, summarizeCoverage, type CoverageSummary, type SmsCoverageStatus } from './relayCoverage';
import { normalizePhoneAndCountry } from './phoneCountry';
import {
  usageMonthKey, resolveEscalationPolicy, type EscalationPolicy,
} from './orgMessagingValidation';
import {
  actorForContext, batchDocFields, classifyRecipientResolution, messageDocFields,
  quotaAllows, summarizeItems,
  type ApiErrorCode, type BatchSummary, type ResolvedItem, type SendItem, type SubmitContext,
} from './orgMessagingApi';

export type SubmitFailureCode = Extract<
  ApiErrorCode,
  'organization_not_found' | 'organization_suspended' | 'quota_exceeded' | 'invalid_escalation' | 'internal_error'
>;

export type SubmitResult =
  | { ok: true; batchId: string; summary: BatchSummary; escalation: EscalationPolicy; escalationScheduled: boolean; smsCoverage: CoverageSummary }
  | { ok: false; code: SubmitFailureCode; message?: string };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Internal control-flow error carrying a structured failure code. */
class SubmitFailure extends Error {
  constructor(public code: SubmitFailureCode) { super(code); }
}

// ─── Org system sender (authors the in-app messages) ─────────────────────────

export function orgSenderUid(organizationId: string): string {
  return `orgsender_${organizationId}`;
}

/**
 * Ensure the org's synthetic sender user (and an empty points wallet for SMS
 * escalation billing) exist, and that the org doc records senderUid.
 */
async function ensureOrgSender(organizationId: string, orgName: string): Promise<string> {
  const uid = orgSenderUid(organizationId);
  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    await userRef.set({
      displayName:      orgName,
      photoURL:         null,
      phoneNumber:      null,
      email:            null,
      username:         null,
      usernameLower:    null,
      about:            'Official organization announcements',
      profileCompleted: true,
      status:           'active',
      isOrgSender:      true,
      organizationId,
      createdAt:        FieldValue.serverTimestamp(),
    });
    // Escalation SMS is billed from this wallet (super admin funds it via the
    // existing wallet tools). Created empty — no welcome credit for senders.
    await adminDb.collection('wallets').doc(uid).set({
      balance: 0, reserved: 0, createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    await adminDb.collection('organizations').doc(organizationId)
      .set({ senderUid: uid }, { merge: true });
  }
  return uid;
}

// ─── Direct conversation per (org sender, recipient) ────────────────────────

function directKey(a: string, b: string): string {
  return [a, b].sort().join('_');
}

/**
 * Get or create the direct conversation between the org sender and one
 * recipient — same doc shape getOrCreateDirectConversation writes, so the
 * unmodified mobile app renders it like any chat.
 */
async function ensureDirectConversation(senderUid: string, recipientUid: string): Promise<string> {
  const key = directKey(senderUid, recipientUid);
  const existing = await adminDb.collection('conversations')
    .where('participantKey', '==', key).limit(1).get();
  if (!existing.empty) return existing.docs[0].id;

  const ref = adminDb.collection('conversations').doc();
  const now = FieldValue.serverTimestamp();
  const participantUids = [senderUid, recipientUid];
  const batch = adminDb.batch();
  batch.set(ref, {
    type:            'direct',
    participantUids,
    participantKey:  key,
    createdBy:       senderUid,
    status:          'active',
    lastMessage:     null,
    createdAt:       now,
    updatedAt:       now,
    // Back-compat aliases (existing trigger/dashboard read these).
    memberIds:       participantUids,
    lastMessageText: '',
    lastMessageAt:   now,
    lastSenderId:    '',
  });
  for (const uid of participantUids) {
    batch.set(ref.collection('userState').doc(uid), {
      uid,
      pinned: false, muted: false, archived: false, favorite: false,
      unreadCount: 0,
      lastReadAt: now,
      lastMessagePreview: '',
      lastMessageAt: now,
      updatedAt: now,
    });
  }
  await batch.commit();
  return ref.id;
}

/** The in-app text for one org message item. */
export function composeInAppText(title: string, body: string): string {
  return `${title}\n\n${body}`;
}

/**
 * Write the real message doc (same shape sendTextMessage writes). The
 * onMessageCreate trigger then fans out the pending receipt, unread count and
 * lastMessage — no extra work here, and no mobile change anywhere.
 */
async function writeOrgMessage(
  conversationId: string,
  senderUid: string,
  senderName: string,
  text: string,
): Promise<string> {
  const msgRef = adminDb.collection('conversations').doc(conversationId)
    .collection('messages').doc();
  await msgRef.set({
    conversationId,
    senderUid,
    senderId:           senderUid,        // back-compat alias
    type:               'text',
    text,
    status:             'sent',
    deletedForEveryone: false,
    editedAt:           null,
    replyTo:            null,
    forwarded:          false,
    forwardedFrom:      null,
    reactions:          null,
    pinnedAt:           null,
    pinnedBy:           null,
    expiresAt:          null,
    createdAt:          FieldValue.serverTimestamp(),
    updatedAt:          FieldValue.serverTimestamp(),
    clientLocalId:      null,
    idempotencyKey:     null,
    senderDisplayName:  senderName,
    senderPhotoURL:     null,
  });
  return msgRef.id;
}

// ─── Recipient resolution (backend-only lookups) ─────────────────────────────

async function resolveItems(items: SendItem[]): Promise<ResolvedItem[]> {
  const userIds = [...new Set(items
    .map(i => (i.recipient as { userId?: string }).userId)
    .filter((v): v is string => typeof v === 'string'))];
  const phones = [...new Set(items
    .map(i => (i.recipient as { phone?: string }).phone)
    .filter((v): v is string => typeof v === 'string'))];

  const existingUsers = new Set<string>();
  for (const ids of chunk(userIds, 100)) {
    const snaps = await adminDb.getAll(...ids.map(id => adminDb.collection('users').doc(id)));
    for (const s of snaps) if (s.exists) existingUsers.add(s.id);
  }

  const phoneToUid = new Map<string, string>();
  for (const ph of chunk(phones, 10)) {
    // F1 Phase B: resolve phone → uid via the owner-only private/profile
    // collection group (PII no longer on the public users doc).
    const snap = await adminDb.collectionGroup('private').where('phoneNumber', 'in', ph).get();
    for (const d of snap.docs) {
      if (d.id !== 'profile') continue;
      const ownerUid = d.ref.parent?.parent?.id;
      const p = (d.get('phoneNumber') as string | undefined) ?? '';
      if (ownerUid && p && !phoneToUid.has(p)) phoneToUid.set(p, ownerUid);
    }
  }

  return items.map((item): ResolvedItem => ({
    ...item,
    ...classifyRecipientResolution(item.recipient, {
      userExists: uid => existingUsers.has(uid),
      phoneToUid: phone => phoneToUid.get(phone) ?? null,
    }),
  }));
}

/**
 * Country-based relay routing (synchronous, ENFORCING). For each recipient,
 * detect their country and whether the org has a live relay covering it. A
 * recipient whose country has no eligible relay is HARD-BLOCKED: the item's
 * status is set to 'no_relay_for_country' so it is delivered neither in-app nor
 * by SMS (and is excluded from quota). 'covered' and 'unknown' (no phone /
 * undetectable country) pass through unchanged. Mutates each item's
 * smsRelayCoverage/recipientCountryCode/status and returns the coverage summary.
 */
async function applySmsCoverage(organizationId: string, resolved: ResolvedItem[]): Promise<CoverageSummary> {
  const cov = await loadOrgRelayCoverage(organizationId);
  const uids = [...new Set(resolved.map(r => r.resolvedUserId).filter((v): v is string => !!v))];
  const uidPhone = new Map<string, string>();
  for (const ids of chunk(uids, 100)) {
    const snaps = await adminDb.getAll(...ids.map(id => adminDb.collection('users').doc(id)));
    for (const s of snaps) {
      const p = s.get('phoneNumber') as string | undefined;
      if (p) uidPhone.set(s.id, p);
    }
  }
  const statuses: SmsCoverageStatus[] = [];
  for (const item of resolved) {
    const r = item.recipient as { phone?: string };
    const phone = r.phone ?? (item.resolvedUserId ? uidPhone.get(item.resolvedUserId) ?? null : null);
    let status: SmsCoverageStatus = 'unknown';
    let countryCode: string | null = null;
    if (phone) {
      const norm = normalizePhoneAndCountry(phone);
      if (norm.countryCode) {
        countryCode = norm.countryCode;
        status = cov.has(norm.countryCode) ? 'covered' : 'no_relay_for_country';
      }
    }
    item.recipientCountryCode = countryCode;
    item.smsRelayCoverage = status;
    // Hard country block: only downgrade items that would otherwise deliver
    // (queued). failed/unsupported items keep their original reason.
    if (status === 'no_relay_for_country' && item.status === 'queued') {
      item.status = 'no_relay_for_country';
      item.failureReason = 'no_relay_for_country';
      item.resolvedUserId = null;   // do not create an in-app conversation/message
    }
    statuses.push(status);
  }
  return summarizeCoverage(statuses);
}

async function writeBatchAudit(
  action: 'organization_message_batch_created' | 'organization_message_batch_failed',
  organizationId: string,
  ctx: SubmitContext,
  metadata: Record<string, unknown>,
  result: 'success' | 'failure',
) {
  const actor = actorForContext(ctx);
  try {
    await adminDb.collection('auditLogs').add({
      action,
      actorUid:   actor.actorUid,
      actorEmail: actor.actorEmail,
      targetType: 'organization',
      targetId:   organizationId,
      result,
      metadata,
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }
}

// ─── The shared submission path ───────────────────────────────────────────────

export async function submitOrganizationMessageBatch(
  organizationId: string,
  items: SendItem[],
  ctx: SubmitContext,
  options?: { escalationOverride?: unknown },
): Promise<SubmitResult> {
  // 0 — Org pre-read: name + escalation default (status/quota re-checked in
  //     the transaction below).
  let orgName = organizationId;
  let policy: EscalationPolicy;
  try {
    const orgSnap = await adminDb.collection('organizations').doc(organizationId).get();
    if (!orgSnap.exists) return { ok: false, code: 'organization_not_found' };
    const org = orgSnap.data() ?? {};
    orgName = (org.name as string | undefined) ?? organizationId;
    const resolved = resolveEscalationPolicy(
      org.messagingEscalation as Partial<EscalationPolicy> | undefined,
      options?.escalationOverride as never,
    );
    if ('error' in resolved) return { ok: false, code: 'invalid_escalation', message: resolved.error };
    policy = resolved;
  } catch { return { ok: false, code: 'internal_error' }; }

  // 1 — Resolve recipients (userId existence + phone→user lookup).
  let resolved: ResolvedItem[];
  try { resolved = await resolveItems(items); }
  catch { return { ok: false, code: 'internal_error' }; }

  // Country-based relay routing (synchronous, ENFORCING). Recipients whose
  // country has no eligible relay are hard-blocked here (status →
  // no_relay_for_country) BEFORE the summary/quota, so they are neither
  // delivered in-app nor counted against the org's quota.
  let smsCoverage: CoverageSummary = { covered: 0, noRelay: 0, unknown: 0 };
  try { smsCoverage = await applySmsCoverage(organizationId, resolved); }
  catch { /* if coverage can't be loaded, fall back to in-app delivery (SMS step stays dispatcher-gated) */ }

  const summary = summarizeItems(resolved);

  const escalationScheduled = policy.enabled && summary.accepted > 0;
  const escalateAt = escalationScheduled
    ? Timestamp.fromMillis(Date.now() + policy.delayMinutes * 60_000)
    : null;

  // 2 — Org status + quota + batch creation, atomically. The whole request
  //     must fit in the remaining quota; only accepted (queued) messages are
  //     counted against it.
  const month = usageMonthKey();
  const counterRef = adminDb.collection('organizationUsageCounters').doc(`${organizationId}_${month}`);
  const batchRef = adminDb.collection('organizationMessageBatches').doc();
  try {
    await adminDb.runTransaction(async tx => {
      const orgSnap = await tx.get(adminDb.collection('organizations').doc(organizationId));
      if (!orgSnap.exists) throw new SubmitFailure('organization_not_found');
      const org = orgSnap.data() ?? {};
      if ((org.status as string) !== 'active') throw new SubmitFailure('organization_suspended');

      const limit = (org.monthlyMessageLimit as number | undefined) ?? 0;
      const counterSnap = await tx.get(counterRef);
      const used = (counterSnap.data()?.used as number | undefined) ?? 0;
      if (!quotaAllows(limit, used, summary.total)) throw new SubmitFailure('quota_exceeded');

      tx.set(counterRef, {
        organizationId,
        month,
        used:      used + summary.accepted,
        limit,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(batchRef, {
        ...batchDocFields(organizationId, summary, ctx),
        delivered:        0,                 // receipt-backed; sweeper updates
        read:             0,
        escalation:       { enabled: policy.enabled, delayMinutes: policy.delayMinutes, audience: policy.audience },
        escalateAt,
        escalationStatus: escalationScheduled ? 'scheduled' : 'none',
        createdAt:        FieldValue.serverTimestamp(),
        completedAt:      null,
      });
    });
  } catch (e) {
    const code = e instanceof SubmitFailure ? e.code : 'internal_error';
    if (code === 'quota_exceeded') {
      await writeBatchAudit('organization_message_batch_failed', organizationId, ctx,
        { reason: 'quota_exceeded', requested: summary.total, source: ctx.source }, 'failure');
    }
    return { ok: false, code };
  }

  // 3 — REAL in-app delivery: one direct conversation (org sender ↔ user) per
  //     recipient, one real message doc per item. The existing trigger fans
  //     out receipts; the unmodified app reports delivered/read.
  let senderUid = '';
  try { senderUid = await ensureOrgSender(organizationId, orgName); }
  catch { /* sender failure degrades to logging-only below */ }

  const convoCache = new Map<string, string>();   // recipientUid → conversationId
  let deliveryFailures = 0;
  if (senderUid) {
    for (const part of chunk(resolved.filter(r => r.status === 'queued' && r.resolvedUserId), 20)) {
      await Promise.all(part.map(async item => {
        const uid = item.resolvedUserId as string;
        try {
          let convoId = convoCache.get(uid);
          if (!convoId) {
            convoId = await ensureDirectConversation(senderUid, uid);
            convoCache.set(uid, convoId);
          }
          const messageId = await writeOrgMessage(
            convoId, senderUid, orgName, composeInAppText(item.title, item.body),
          );
          (item as ResolvedItem & { conversationId?: string; messageId?: string }).conversationId = convoId;
          (item as ResolvedItem & { conversationId?: string; messageId?: string }).messageId = messageId;
        } catch {
          item.status = 'failed';
          item.failureReason = 'delivery_write_failed';
          deliveryFailures++;
        }
      }));
    }
  } else {
    for (const item of resolved) {
      if (item.status === 'queued') {
        item.status = 'failed';
        item.failureReason = 'delivery_write_failed';
        deliveryFailures++;
      }
    }
  }

  // Recount after delivery writes; release quota for any failed writes and
  // refresh the batch counts so the record stays truthful.
  const finalSummary = deliveryFailures > 0 ? summarizeItems(resolved) : summary;
  if (deliveryFailures > 0) {
    try {
      await adminDb.runTransaction(async tx => {
        const counterSnap = await tx.get(counterRef);
        const used = (counterSnap.data()?.used as number | undefined) ?? 0;
        tx.set(counterRef, { used: Math.max(0, used - deliveryFailures), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      });
      await batchRef.update({
        status:   finalSummary.batchStatus,
        accepted: finalSummary.accepted,
        queued:   finalSummary.queued,
        failed:   finalSummary.failed,
        ...(finalSummary.accepted === 0 ? { escalationStatus: 'none', escalateAt: null } : {}),
      });
    } catch { /* best-effort */ }
  }

  // 4 — Per-recipient message logs (chunked WriteBatches; ≤500 ops each).
  try {
    for (const part of chunk(resolved, 400)) {
      const wb = adminDb.batch();
      for (const item of part) {
        const extra = item as ResolvedItem & { conversationId?: string; messageId?: string };
        wb.set(adminDb.collection('organizationMessages').doc(), {
          ...messageDocFields(organizationId, batchRef.id, item),
          conversationId: extra.conversationId ?? null,
          messageId:      extra.messageId ?? null,
          smsEscalation:  null,                  // sweeper fills queued/failed/skipped
          createdAt:      FieldValue.serverTimestamp(),
        });
      }
      await wb.commit();
    }
    await batchRef.update({ completedAt: FieldValue.serverTimestamp() });
  } catch {
    try { await batchRef.update({ status: 'failed' }); } catch { /* best-effort */ }
    return { ok: false, code: 'internal_error' };
  }

  // 5 — Audit (counts only; never message bodies, keys, or tokens).
  await writeBatchAudit('organization_message_batch_created', organizationId, ctx, {
    batchId: batchRef.id, source: ctx.source,
    total: finalSummary.total, accepted: finalSummary.accepted,
    failed: finalSummary.failed, unsupported: finalSummary.unsupported,
    escalationScheduled: escalationScheduled && finalSummary.accepted > 0,
    escalationAudience: policy.audience,
    escalationDelayMinutes: policy.delayMinutes,
  }, 'success');

  return {
    ok: true,
    batchId: batchRef.id,
    summary: finalSummary,
    escalation: policy,
    escalationScheduled: escalationScheduled && finalSummary.accepted > 0,
    smsCoverage,
  };
}
