// POST /api/v1/org/messages/send — Organization Messaging API (MVP).
//
// Auth: Authorization: Bearer offmsg_live_…  (hash-only lookup; the raw key is
// never stored or logged). Accepts shape A ({title, body, recipients[]}) and
// shape B ({messages[]}). Batch/log creation, quota and honest statuses live
// in the shared submitOrganizationMessageBatch service — the SAME path the
// dashboard send form uses (source differs: 'api' here).
//
// HONESTY RULE: there is no backend-only delivery primitive in this MVP, so
// nothing is ever marked `sent` or `delivered`.

import { NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { hashApiKey } from '@/lib/orgMessagingKeys';
import { apiError, parseAuthHeader, parseSendRequest, type ApiErrorCode } from '@/lib/orgMessagingApi';
import { submitOrganizationMessageBatch } from '@/lib/orgMessagingService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(code: ApiErrorCode, message?: string) {
  const e = apiError(code, message);
  return NextResponse.json(e.body, { status: e.http });
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

  // 4 — Shared submission path (resolution, quota transaction, batch + logs,
  //     usage counter, audit) — identical to the dashboard form.
  const result = await submitOrganizationMessageBatch(organizationId, parsed.items, {
    source: 'api',
    keyId,
  });
  if (!result.ok) return fail(result.code);

  // 5 — lastUsedAt (soft-fail; key id only, never the raw key).
  try {
    await adminDb.collection('organizationApiKeys').doc(keyId)
      .update({ lastUsedAt: FieldValue.serverTimestamp() });
  } catch { /* soft-fail */ }

  return NextResponse.json({
    ok:          true,
    batchId:     result.batchId,
    total:       result.summary.total,
    accepted:    result.summary.accepted,
    failed:      result.summary.failed,
    unsupported: result.summary.unsupported,
    status:      result.summary.batchStatus,
  }, { status: 200 });
}
