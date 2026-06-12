// Organization Messaging — Admin-SDK read helpers for the dashboard page.
//
// Same conventions as adminData.ts: callers MUST verify session + capability
// (+ org scope) first; reads are limited; returns plain serializable objects.
// Collections (formalized through the MVP phases):
//   organizationApiKeys/{keyId}            — hash-only API keys (Phase 3)
//   organizationMessageBatches/{batchId}   — one row per send (Phases 4–6)
//   organizationMessages/{messageId}       — one row per recipient (Phases 4–6)
//   organizationUsageCounters/{orgId_YYYY-MM} — monthly quota usage (Phase 6)

import { adminDb } from './firebase-admin';
import { usageMonthKey } from './orgMessagingValidation';
import { pickApiKeyStatusRow } from './orgMessagingKeys';
import {
  createdAtMs, mapBatchRow, mapMessageRow, percentUsed,
  type OrgBatchRow, type OrgMessageRow,
} from './orgMessagingApi';

export type { OrgBatchRow, OrgMessageRow };

// ─── Usage summary ────────────────────────────────────────────────────────────

export type OrgMessagingOverview = {
  organizationId:      string;
  name:                string;
  status:              string;            // active | suspended | disabled
  monthlyMessageLimit: number;            // 0 = not configured
  usedThisMonth:       number;            // accepted/queued only — failed and
                                          // unsupported recipients never count
  remainingThisMonth:  number;
  percentUsed:         number;            // 0–100
  monthKey:            string;            // 'YYYY-MM'
};

export async function getOrgMessagingOverview(orgId: string): Promise<OrgMessagingOverview | null> {
  const orgSnap = await adminDb.collection('organizations').doc(orgId).get();
  if (!orgSnap.exists) return null;
  const org = orgSnap.data() ?? {};

  const month = usageMonthKey();
  let used = 0;
  try {
    const usage = await adminDb.collection('organizationUsageCounters').doc(`${orgId}_${month}`).get();
    used = (usage.data()?.used as number | undefined) ?? 0;
  } catch { /* counter not created yet */ }

  const limit = (org.monthlyMessageLimit as number | undefined) ?? 0;
  return {
    organizationId:      orgId,
    name:                (org.name as string | undefined) ?? orgId,
    status:              (org.status as string | undefined) ?? 'active',
    monthlyMessageLimit: limit,
    usedThisMonth:       used,
    remainingThisMonth:  Math.max(0, limit - used),
    percentUsed:         percentUsed(limit, used),
    monthKey:            month,
  };
}

// ─── API key status (status only — never the hash) ───────────────────────────

export type { ApiKeyStatusRow as OrgApiKeyStatus } from './orgMessagingKeys';

export async function getOrgApiKeyStatus(orgId: string) {
  try {
    // Equality-only query (no composite index needed); selection + the
    // hash-free mapping live in the pure, unit-tested pickApiKeyStatusRow.
    const snap = await adminDb.collection('organizationApiKeys')
      .where('organizationId', '==', orgId).limit(20).get();
    return pickApiKeyStatusRow(
      snap.docs.map(d => ({ id: d.id, data: d.data() as Record<string, unknown> })),
    );
  } catch { return null; }
}

// ─── Message batch logs ───────────────────────────────────────────────────────
// All rows flow through the pure allow-list mappers (mapBatchRow /
// mapMessageRow), so secrets such as keyHash can never appear in a read model.

export async function listOrgMessageBatches(orgId: string, max = 20): Promise<OrgBatchRow[]> {
  try {
    // Equality-only query + in-memory sort: avoids a composite index until the
    // Phase 7 index lands; volumes here are small (recent logs only).
    const snap = await adminDb.collection('organizationMessageBatches')
      .where('organizationId', '==', orgId).limit(200).get();
    return snap.docs
      .sort((a, b) => createdAtMs(b.data()) - createdAtMs(a.data()))
      .slice(0, max)
      .map(d => mapBatchRow(d.id, d.data() as Record<string, unknown>));
  } catch { return []; }
}

/** One batch by id. Callers MUST scope-check `organizationId` on the result. */
export async function getOrgMessageBatch(batchId: string): Promise<OrgBatchRow | null> {
  try {
    const snap = await adminDb.collection('organizationMessageBatches').doc(batchId).get();
    if (!snap.exists) return null;
    return mapBatchRow(snap.id, snap.data() as Record<string, unknown>);
  } catch { return null; }
}

/** Per-recipient logs for a batch — latest MESSAGE_ROWS_MAX rows (no pagination in the MVP). */
export const MESSAGE_ROWS_MAX = 500;

export async function listBatchMessages(batchId: string, max = MESSAGE_ROWS_MAX): Promise<OrgMessageRow[]> {
  try {
    const snap = await adminDb.collection('organizationMessages')
      .where('batchId', '==', batchId).limit(max).get();
    return snap.docs
      .sort((a, b) => createdAtMs(b.data()) - createdAtMs(a.data()))
      .map(d => mapMessageRow(d.id, d.data() as Record<string, unknown>));
  } catch { return []; }
}
