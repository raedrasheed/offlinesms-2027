// Organization Messaging — the ONE submission path shared by the public API
// route and the dashboard server action. Handles recipient resolution
// (backend-only lookups), organization status checks, transaction-safe
// monthly quota enforcement, batch + per-recipient log creation, usage
// counter increment, and audit — with honest statuses only (queued / failed /
// unsupported_recipient; never sent/delivered: no delivery happens here).
//
// SECURITY: this runs with the Admin SDK, which BYPASSES Firestore rules.
// Callers must do their own authorization first (API route: bearer-key auth;
// dashboard action: session + capability + org scope). This service only
// re-checks the organization's existence/status and quota.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { usageMonthKey } from './orgMessagingValidation';
import {
  actorForContext, batchDocFields, classifyRecipientResolution, messageDocFields,
  quotaAllows, summarizeItems,
  type ApiErrorCode, type BatchSummary, type ResolvedItem, type SendItem, type SubmitContext,
} from './orgMessagingApi';

export type SubmitFailureCode = Extract<
  ApiErrorCode,
  'organization_not_found' | 'organization_suspended' | 'quota_exceeded' | 'internal_error'
>;

export type SubmitResult =
  | { ok: true; batchId: string; summary: BatchSummary }
  | { ok: false; code: SubmitFailureCode };

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Internal control-flow error carrying a structured failure code. */
class SubmitFailure extends Error {
  constructor(public code: SubmitFailureCode) { super(code); }
}

/**
 * Resolve recipients to honest statuses (backend-only):
 *  • userId → users/{id} exists? queued : failed(user_not_found)
 *  • phone  → users where phoneNumber == … ? queued(resolvedUserId) : unsupported_recipient
 */
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
    const snap = await adminDb.collection('users').where('phoneNumber', 'in', ph).get();
    for (const d of snap.docs) {
      const p = (d.data().phoneNumber as string | undefined) ?? '';
      if (p && !phoneToUid.has(p)) phoneToUid.set(p, d.id);
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

export async function submitOrganizationMessageBatch(
  organizationId: string,
  items: SendItem[],
  ctx: SubmitContext,
): Promise<SubmitResult> {
  // 1 — Resolve recipients to honest statuses (no delivery is performed).
  let resolved: ResolvedItem[];
  try { resolved = await resolveItems(items); }
  catch { return { ok: false, code: 'internal_error' }; }
  const summary = summarizeItems(resolved);

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
        createdAt:   FieldValue.serverTimestamp(),
        completedAt: null,
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

  // 3 — Per-recipient message logs (chunked WriteBatches; ≤500 ops each).
  try {
    for (const part of chunk(resolved, 400)) {
      const wb = adminDb.batch();
      for (const item of part) {
        wb.set(adminDb.collection('organizationMessages').doc(), {
          ...messageDocFields(organizationId, batchRef.id, item),
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await wb.commit();
    }
    await batchRef.update({ completedAt: FieldValue.serverTimestamp() });
  } catch {
    try { await batchRef.update({ status: 'failed' }); } catch { /* best-effort */ }
    return { ok: false, code: 'internal_error' };
  }

  // 4 — Audit (metadata never contains raw keys or recipient payloads beyond counts).
  await writeBatchAudit('organization_message_batch_created', organizationId, ctx, {
    batchId: batchRef.id, source: ctx.source,
    total: summary.total, accepted: summary.accepted,
    failed: summary.failed, unsupported: summary.unsupported,
  }, 'success');

  return { ok: true, batchId: batchRef.id, summary };
}
