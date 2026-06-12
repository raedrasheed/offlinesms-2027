// Organization Messaging API — pure request/response logic for
// POST /api/v1/org/messages/send. No Firebase imports: everything here
// (auth-header parsing, both payload shapes, error mapping, status
// summaries, quota math) is unit-testable in isolation. The route handler
// adds only the Firestore reads/writes.

import {
  ORG_MSG_TITLE_MAX, ORG_MSG_BODY_MAX, ORG_MSG_MAX_RECIPIENTS,
  parseRecipientLine, type OrgRecipient, type OrgMessageStatus, type OrgBatchStatus,
} from './orgMessagingValidation';
import { isApiKeyFormat } from './orgMessagingKeys';

// ─── Error codes → HTTP + message ────────────────────────────────────────────

export type ApiErrorCode =
  | 'missing_authorization'
  | 'invalid_key_format'
  | 'invalid_key'
  | 'revoked_key'
  | 'organization_not_found'
  | 'organization_suspended'
  | 'invalid_payload'
  | 'too_many_recipients'
  | 'quota_exceeded'
  | 'internal_error';

export const API_ERRORS: Record<ApiErrorCode, { http: number; message: string }> = {
  missing_authorization:  { http: 401, message: 'Missing Authorization header. Use: Authorization: Bearer offmsg_live_…' },
  invalid_key_format:     { http: 401, message: 'API key format is invalid.' },
  invalid_key:            { http: 401, message: 'API key is not recognized.' },
  revoked_key:            { http: 401, message: 'API key has been revoked.' },
  organization_not_found: { http: 403, message: 'No organization is associated with this API key.' },
  organization_suspended: { http: 403, message: 'Organization is suspended.' },
  invalid_payload:        { http: 400, message: 'Invalid request payload.' },
  too_many_recipients:    { http: 400, message: `At most ${ORG_MSG_MAX_RECIPIENTS} recipients per request.` },
  quota_exceeded:         { http: 429, message: 'Monthly message quota exceeded.' },
  internal_error:         { http: 500, message: 'Internal error. Please try again.' },
};

export function apiError(code: ApiErrorCode, message?: string): {
  http: number;
  body: { ok: false; error: { code: ApiErrorCode; message: string } };
} {
  const def = API_ERRORS[code];
  return { http: def.http, body: { ok: false, error: { code, message: message ?? def.message } } };
}

// ─── Bearer auth header ───────────────────────────────────────────────────────

export function parseAuthHeader(header: string | null | undefined):
  | { key: string }
  | { errorCode: 'missing_authorization' | 'invalid_key_format' } {
  if (!header || !header.trim()) return { errorCode: 'missing_authorization' };
  const m = header.trim().match(/^Bearer\s+(.+)$/i);
  if (!m) return { errorCode: 'missing_authorization' };
  const key = m[1].trim();
  if (!isApiKeyFormat(key)) return { errorCode: 'invalid_key_format' };
  return { key };
}

// ─── Payload parsing (shapes A and B) ────────────────────────────────────────

export type SendItem = { recipient: OrgRecipient; title: string; body: string };

type ParseResult = { items: SendItem[] } | { errorCode: 'invalid_payload' | 'too_many_recipients'; message?: string };

function cleanTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= ORG_MSG_TITLE_MAX ? t : null;
}
function cleanBody(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const b = v.trim();
  return b.length >= 1 && b.length <= ORG_MSG_BODY_MAX ? b : null;
}

/**
 * Validate a structured recipient object: exactly one of phone | userId,
 * with the same rules as the dashboard textarea (E.164 phones; digits-only
 * rejected as a phone missing '+').
 */
export function parseRecipientObject(v: unknown): OrgRecipient | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as { phone?: unknown; userId?: unknown };
  const hasPhone = typeof o.phone === 'string' && o.phone.trim() !== '';
  const hasUser  = typeof o.userId === 'string' && o.userId.trim() !== '';
  if (hasPhone === hasUser) return null;            // exactly one required
  const parsed = parseRecipientLine(hasPhone ? (o.phone as string) : (o.userId as string));
  if (!parsed) return null;
  // The line parser may classify either way — pin it to the declared field.
  if (hasPhone && !('phone' in parsed)) return null;
  if (hasUser && !('userId' in parsed)) return null;
  return parsed;
}

/**
 * Parse + validate the request body. Shape A: { title, body, recipients[] }.
 * Shape B: { messages: [{ phone|userId, title, body }] }. Exactly one shape
 * must be present.
 */
export function parseSendRequest(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { errorCode: 'invalid_payload', message: 'Body must be a JSON object.' };
  }
  const o = raw as { title?: unknown; body?: unknown; recipients?: unknown; messages?: unknown };
  const hasA = o.recipients !== undefined;
  const hasB = o.messages !== undefined;
  if (hasA === hasB) {
    return { errorCode: 'invalid_payload', message: 'Provide either "recipients" (shape A) or "messages" (shape B), not both.' };
  }

  if (hasA) {
    const title = cleanTitle(o.title);
    if (!title) return { errorCode: 'invalid_payload', message: `"title" is required (1–${ORG_MSG_TITLE_MAX} chars).` };
    const body = cleanBody(o.body);
    if (!body) return { errorCode: 'invalid_payload', message: `"body" is required (1–${ORG_MSG_BODY_MAX} chars).` };
    if (!Array.isArray(o.recipients) || o.recipients.length === 0) {
      return { errorCode: 'invalid_payload', message: '"recipients" must be a non-empty array.' };
    }
    if (o.recipients.length > ORG_MSG_MAX_RECIPIENTS) return { errorCode: 'too_many_recipients' };
    const items: SendItem[] = [];
    for (let i = 0; i < o.recipients.length; i++) {
      const r = parseRecipientObject(o.recipients[i]);
      if (!r) {
        return { errorCode: 'invalid_payload', message: `recipients[${i}] must have exactly one of "phone" (+E.164) or "userId".` };
      }
      items.push({ recipient: r, title, body });
    }
    return { items };
  }

  // Shape B
  if (!Array.isArray(o.messages) || o.messages.length === 0) {
    return { errorCode: 'invalid_payload', message: '"messages" must be a non-empty array.' };
  }
  if (o.messages.length > ORG_MSG_MAX_RECIPIENTS) return { errorCode: 'too_many_recipients' };
  const items: SendItem[] = [];
  for (let i = 0; i < o.messages.length; i++) {
    const m = o.messages[i] as { title?: unknown; body?: unknown; phone?: unknown; userId?: unknown };
    const r = parseRecipientObject(m);
    if (!r) {
      return { errorCode: 'invalid_payload', message: `messages[${i}] must have exactly one of "phone" (+E.164) or "userId".` };
    }
    const title = cleanTitle(m.title);
    if (!title) return { errorCode: 'invalid_payload', message: `messages[${i}].title is required (1–${ORG_MSG_TITLE_MAX} chars).` };
    const body = cleanBody(m.body);
    if (!body) return { errorCode: 'invalid_payload', message: `messages[${i}].body is required (1–${ORG_MSG_BODY_MAX} chars).` };
    items.push({ recipient: r, title, body });
  }
  return { items };
}

// ─── Quota + status summary ──────────────────────────────────────────────────

/** Simple conservative check: the WHOLE request must fit in the remaining quota. */
export function quotaAllows(limit: number, used: number, requested: number): boolean {
  return requested <= Math.max(0, limit - used);
}

export type ResolvedItem = SendItem & {
  status:         OrgMessageStatus;     // queued | failed | unsupported_recipient (never sent/delivered)
  failureReason:  string | null;
  resolvedUserId: string | null;
};

export type BatchSummary = {
  total:       number;
  accepted:    number;   // recorded with a viable in-app target → 'queued'
  queued:      number;
  failed:      number;
  unsupported: number;
  batchStatus: OrgBatchStatus;
};

export function summarizeItems(items: Array<Pick<ResolvedItem, 'status'>>): BatchSummary {
  const queued      = items.filter(i => i.status === 'queued').length;
  const failed      = items.filter(i => i.status === 'failed').length;
  const unsupported = items.filter(i => i.status === 'unsupported_recipient').length;
  const batchStatus: OrgBatchStatus = queued === items.length
    ? 'accepted'
    : queued > 0 ? 'partial' : 'failed';
  return { total: items.length, accepted: queued, queued, failed, unsupported, batchStatus };
}

// ─── Shared submission context + doc shaping (pure) ──────────────────────────
// Used by the shared submitOrganizationMessageBatch service so the API route
// and the dashboard server action write byte-identical records, differing only
// in source/createdBy/actor.

export type SubmitContext =
  | { source: 'api'; keyId: string }
  | { source: 'dashboard'; userUid: string; userEmail: string | null };

export function actorForContext(ctx: SubmitContext): { actorUid: string; actorEmail: string | null } {
  return ctx.source === 'api'
    ? { actorUid: `apikey:${ctx.keyId}`, actorEmail: null }
    : { actorUid: ctx.userUid, actorEmail: ctx.userEmail };
}

export function createdByForContext(ctx: SubmitContext): string {
  return ctx.source === 'api' ? ctx.keyId : ctx.userUid;
}

/**
 * Honest classification of one recipient given the backend-only lookups:
 *  • userId  → exists ? queued : failed(user_not_found)
 *  • phone   → linked user ? queued(resolvedUserId) : unsupported_recipient
 * Never returns sent/delivered — no delivery happens in this MVP.
 */
export function classifyRecipientResolution(
  recipient: OrgRecipient,
  lookups: { userExists: (uid: string) => boolean; phoneToUid: (phone: string) => string | null },
): Pick<ResolvedItem, 'status' | 'failureReason' | 'resolvedUserId'> {
  const r = recipient as { userId?: string; phone?: string };
  if (typeof r.userId === 'string') {
    return lookups.userExists(r.userId)
      ? { status: 'queued', failureReason: null, resolvedUserId: r.userId }
      : { status: 'failed', failureReason: 'user_not_found', resolvedUserId: null };
  }
  const uid = lookups.phoneToUid(r.phone ?? '');
  return uid !== null
    ? { status: 'queued', failureReason: null, resolvedUserId: uid }
    : { status: 'unsupported_recipient', failureReason: 'phone_not_linked_to_user', resolvedUserId: null };
}

/** Batch doc fields minus server timestamps (the service adds those). */
export function batchDocFields(organizationId: string, summary: BatchSummary, ctx: SubmitContext) {
  return {
    organizationId,
    source:      ctx.source,
    createdBy:   createdByForContext(ctx),
    status:      summary.batchStatus,
    total:       summary.total,
    accepted:    summary.accepted,
    queued:      summary.queued,
    failed:      summary.failed,
    unsupported: summary.unsupported,
  };
}

/** Per-recipient message log fields minus server timestamps. */
export function messageDocFields(organizationId: string, batchId: string, item: ResolvedItem) {
  const r = item.recipient as { userId?: string; phone?: string };
  return {
    organizationId,
    batchId,
    recipientType:  typeof r.userId === 'string' ? 'userId' : 'phone',
    recipientValue: typeof r.userId === 'string' ? r.userId : (r.phone ?? ''),
    resolvedUserId: item.resolvedUserId,
    title:          item.title,
    body:           item.body,
    status:         item.status,
    failureReason:  item.failureReason,
  };
}
