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
import { usageMonthKey, type OrgBatchStatus } from './orgMessagingValidation';

function safeDate(v: unknown): string {
  try {
    const d = (v as { toDate?: () => Date })?.toDate?.();
    return d ? d.toISOString() : '';
  } catch { return ''; }
}

// ─── Usage summary ────────────────────────────────────────────────────────────

export type OrgMessagingOverview = {
  organizationId:      string;
  name:                string;
  status:              string;            // active | suspended | disabled
  monthlyMessageLimit: number;            // 0 = not configured
  usedThisMonth:       number;
  remainingThisMonth:  number;
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
    monthKey:            month,
  };
}

// ─── API key status (status only — never the hash) ───────────────────────────

export type OrgApiKeyStatus = {
  keyId:      string;
  status:     string;        // active | revoked
  createdAt:  string;
  revokedAt:  string;
  lastUsedAt: string;
};

export async function getOrgApiKeyStatus(orgId: string): Promise<OrgApiKeyStatus | null> {
  try {
    // Equality-only query (no composite index needed); newest picked in memory.
    const snap = await adminDb.collection('organizationApiKeys')
      .where('organizationId', '==', orgId).limit(20).get();
    if (snap.empty) return null;
    const rows: Array<{ id: string; data: Record<string, unknown> }> =
      snap.docs.map(d => ({ id: d.id, data: d.data() as Record<string, unknown> }));
    // Prefer the active key; otherwise the most recently created.
    const active = rows.find(r => r.data.status === 'active');
    const pick = active ?? rows.sort((a, b) =>
      ((b.data.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0)
      - ((a.data.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0))[0];
    return {
      keyId:      pick.id,
      status:     (pick.data.status as string | undefined) ?? 'revoked',
      createdAt:  safeDate(pick.data.createdAt),
      revokedAt:  safeDate(pick.data.revokedAt),
      lastUsedAt: safeDate(pick.data.lastUsedAt),
    };
  } catch { return null; }
}

// ─── Message batch logs ───────────────────────────────────────────────────────

export type OrgBatchRow = {
  id:        string;
  source:    string;          // dashboard | api
  status:    OrgBatchStatus | string;
  total:     number;
  accepted:  number;
  failed:    number;
  createdAt: string;
};

export async function listOrgMessageBatches(orgId: string, max = 20): Promise<OrgBatchRow[]> {
  try {
    // Equality-only query + in-memory sort: avoids a composite index until the
    // Phase 7 index lands; volumes here are small (recent logs only).
    const snap = await adminDb.collection('organizationMessageBatches')
      .where('organizationId', '==', orgId).limit(200).get();
    const rows = snap.docs.map(d => {
      const x = d.data() as Record<string, unknown>;
      return {
        id:        d.id,
        source:    (x.source as string | undefined) ?? 'dashboard',
        status:    (x.status as string | undefined) ?? 'accepted',
        total:     (x.total as number | undefined) ?? 0,
        accepted:  (x.accepted as number | undefined) ?? 0,
        failed:    (x.failed as number | undefined) ?? 0,
        createdAt: safeDate(x.createdAt),
        _ms:       ((x.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0),
      };
    });
    rows.sort((a, b) => b._ms - a._ms);
    return rows.slice(0, max).map(({ _ms, ...row }) => row);
  } catch { return []; }
}
