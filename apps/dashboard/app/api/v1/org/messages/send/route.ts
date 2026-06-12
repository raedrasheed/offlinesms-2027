// POST /api/v1/org/messages/send — Organization Messaging API (MVP).
//
// Auth: Authorization: Bearer offmsg_live_…  (hash-only lookup; the raw key is
// never stored or logged). Accepts shape A ({title, body, recipients[]}) and
// shape B ({messages[]}); records a batch + per-recipient logs and counts the
// accepted messages against the organization's monthly quota in a transaction.
//
// HONESTY RULE: there is no backend-only delivery primitive in this MVP, so
// nothing is ever marked `sent` or `delivered`. Recipients that resolve to an
// existing OfflineSMS user are recorded as `queued` (accepted, awaiting future
// delivery wiring); unknown userIds are `failed` (user_not_found); phones with
// no matching user are `unsupported_recipient`.

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { hashApiKey } from '@/lib/orgMessagingKeys';
import { usageMonthKey } from '@/lib/orgMessagingValidation';
import {
  apiError, parseAuthHeader, parseSendRequest, quotaAllows, summarizeItems,
  type ApiErrorCode, type ResolvedItem, type SendItem,
} from '@/lib/orgMessagingApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(http: number, body: unknown) {
  return NextResponse.json(body, { status: http });
}
function fail(code: ApiErrorCode, message?: string) {
  const e = apiError(code, message);
  return json(e.http, e.body);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Resolve recipients to honest statuses (backend-only):
 *  • userId → users/{id} exists? queued : failed(user_not_found)
 *  • phone  → users where phoneNumber == … ? queued(resolvedUserId) : unsupported_recipient
 */
async function resolveItems(items: SendItem[]): Promise<ResolvedItem[]> {
  const userIds = [...new Set(items.filter(i => 'userId' in i.recipient).map(i => (i.recipient as { userId: string }).userId))];
  const phones  = [...new Set(items.filter(i => 'phone' in i.recipient).map(i => (i.recipient as { phone: string }).phone))];

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

  return items.map((item): ResolvedItem => {
    const r = item.recipient as { userId?: string; phone?: string };
    if (typeof r.userId === 'string') {
      const uid = r.userId;
      return existingUsers.has(uid)
        ? { ...item, status: 'queued', failureReason: null, resolvedUserId: uid }
        : { ...item, status: 'failed', failureReason: 'user_not_found', resolvedUserId: null };
    }
    const uid = phoneToUid.get(r.phone ?? '') ?? null;
    return uid !== null
      ? { ...item, status: 'queued', failureReason: null, resolvedUserId: uid }
      : { ...item, status: 'unsupported_recipient', failureReason: 'phone_not_linked_to_user', resolvedUserId: null };
  });
}

export async function POST(request: Request) {
  // 1 — Bearer auth (format gate before any I/O).
  const auth = parseAuthHeader(request.headers.get('authorization'));
  if ('errorCode' in auth) return fail(auth.errorCode);

  // 2 — Key lookup by hash only. The raw key never leaves this scope and is
  //     never logged or persisted.
  const keyHash = hashApiKey(auth.key);
  let keyId = '';
  let organizationId = '';
  try {
    const keySnap = await adminDb.collection('organizationApiKeys')
      .where('keyHash', '==', keyHash).limit(1).get();
    if (keySnap.empty) return fail('invalid_key');
    const keyDoc = keySnap.docs[0];
    if ((keyDoc.data().status as string) !== 'active') return fail('revoked_key');
    keyId = keyDoc.id;
    organizationId = (keyDoc.data().organizationId as string | undefined) ?? '';
  } catch { return fail('internal_error'); }
  if (!organizationId) return fail('organization_not_found');

  // 3 — Payload.
  let body: unknown;
  try { body = await request.json(); }
  catch { return fail('invalid_payload', 'Body must be valid JSON.'); }
  const parsed = parseSendRequest(body);
  if ('errorCode' in parsed) return fail(parsed.errorCode, parsed.message);

  // 4 — Resolve recipients to honest statuses (no delivery is performed).
  let resolved: ResolvedItem[];
  try { resolved = await resolveItems(parsed.items); }
  catch { return fail('internal_error'); }
  const summary = summarizeItems(resolved);

  // 5 — Org status + quota + batch creation, atomically. The whole request
  //     must fit in the remaining quota; only accepted (queued) messages are
  //     counted against it.
  const month = usageMonthKey();
  const counterRef = adminDb.collection('organizationUsageCounters').doc(`${organizationId}_${month}`);
  const batchRef = adminDb.collection('organizationMessageBatches').doc();
  try {
    await adminDb.runTransaction(async tx => {
      const orgSnap = await tx.get(adminDb.collection('organizations').doc(organizationId));
      if (!orgSnap.exists) throw new ApiFailure('organization_not_found');
      const org = orgSnap.data() ?? {};
      if ((org.status as string) !== 'active') throw new ApiFailure('organization_suspended');

      const limit = (org.monthlyMessageLimit as number | undefined) ?? 0;
      const counterSnap = await tx.get(counterRef);
      const used = (counterSnap.data()?.used as number | undefined) ?? 0;
      if (!quotaAllows(limit, used, summary.total)) throw new ApiFailure('quota_exceeded');

      tx.set(counterRef, {
        organizationId,
        month,
        used:      used + summary.accepted,
        limit,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(batchRef, {
        organizationId,
        source:      'api',
        createdBy:   keyId,                 // the API key id — never the raw key
        status:      summary.batchStatus,
        total:       summary.total,
        accepted:    summary.accepted,
        queued:      summary.queued,
        failed:      summary.failed,
        unsupported: summary.unsupported,
        createdAt:   FieldValue.serverTimestamp(),
        completedAt: null,
      });
    });
  } catch (e) {
    if (e instanceof ApiFailure) {
      if (e.code === 'quota_exceeded') {
        try {
          await adminDb.collection('auditLogs').add({
            action: 'organization_message_batch_failed',
            actorUid: `apikey:${keyId}`,
            actorEmail: null,
            targetType: 'organization',
            targetId: organizationId,
            result: 'failure',
            metadata: { reason: 'quota_exceeded', requested: summary.total, source: 'api' },
            createdAt: FieldValue.serverTimestamp(),
          });
        } catch { /* soft-fail */ }
      }
      return fail(e.code);
    }
    return fail('internal_error');
  }

  // 6 — Per-recipient message logs (chunked WriteBatches; ≤500 ops each).
  try {
    for (const part of chunk(resolved, 400)) {
      const wb = adminDb.batch();
      for (const item of part) {
        const ref = adminDb.collection('organizationMessages').doc();
        wb.set(ref, {
          organizationId,
          batchId:        batchRef.id,
          recipientType:  'userId' in item.recipient ? 'userId' : 'phone',
          recipientValue: 'userId' in item.recipient ? item.recipient.userId : item.recipient.phone,
          resolvedUserId: item.resolvedUserId,
          title:          item.title,
          body:           item.body,
          status:         item.status,            // queued | failed | unsupported_recipient
          failureReason:  item.failureReason,
          createdAt:      FieldValue.serverTimestamp(),
        });
      }
      await wb.commit();
    }
    await batchRef.update({ completedAt: FieldValue.serverTimestamp() });
  } catch {
    try { await batchRef.update({ status: 'failed' }); } catch { /* best-effort */ }
    return fail('internal_error');
  }

  // 7 — lastUsedAt + audit (both soft-fail; metadata never contains the key).
  try {
    await adminDb.collection('organizationApiKeys').doc(keyId)
      .update({ lastUsedAt: FieldValue.serverTimestamp() });
  } catch { /* soft-fail */ }
  try {
    await adminDb.collection('auditLogs').add({
      action:     'organization_message_batch_created',
      actorUid:   `apikey:${keyId}`,
      actorEmail: null,
      targetType: 'organization',
      targetId:   organizationId,
      result:     'success',
      metadata:   {
        batchId: batchRef.id, source: 'api',
        total: summary.total, accepted: summary.accepted,
        failed: summary.failed, unsupported: summary.unsupported,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  return json(200, {
    ok:          true,
    batchId:     batchRef.id,
    total:       summary.total,
    accepted:    summary.accepted,
    failed:      summary.failed,
    unsupported: summary.unsupported,
    status:      summary.batchStatus,
  });
}

/** Internal control-flow error carrying a structured API error code. */
class ApiFailure extends Error {
  constructor(public code: ApiErrorCode) { super(code); }
}
