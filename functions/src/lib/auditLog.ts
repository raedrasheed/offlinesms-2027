// Audit log helper.
//
// Every privileged callable should call `writeAuditLog(...)` after the work
// is committed (or, for non-transactional callables, anywhere safe) so we
// have a tamper-evident record of who did what. The helper is intentionally
// soft-failing: an audit-log write that throws *must not* roll back the
// primary action — it logs the failure to stderr and returns.
//
// See docs/OFFLINESMS_DATA_MODEL.md for the auditLogs/{id} schema.

import { getFirestore, FieldValue } from 'firebase-admin/firestore';

export type AuditResult = 'success' | 'failure';

export type AuditActor = {
  uid: string;
  /** Set when the actor is known to be a privileged user; otherwise omit. */
  email?: string | null;
};

export type AuditTarget = {
  type: string;
  id: string;
};

export type WriteAuditLogParams = {
  action: string;                       // dotted namespace, e.g. 'auth.username.claimed'
  actor: AuditActor;
  target?: AuditTarget | null;
  result?: AuditResult;                 // defaults to 'success'
  metadata?: Record<string, unknown>;   // will be sanitised
};

const FORBIDDEN_KEYS = new Set([
  'password', 'token', 'idToken', 'sessionCookie', 'cookie',
  'otp', 'otpCode', 'verificationCode', 'code',
  'secret', 'apiKey', 'privateKey', 'serviceAccount',
  'phone', 'phoneNumber', 'email',
  'messageText', 'body', 'content',
]);

/** Mask all but the last two digits of a phone number. */
export function redactPhone(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 2) return '••';
  return '+' + '•'.repeat(digits.length - 2) + digits.slice(-2);
}

/** Mask the local part of an email so we keep just the domain. */
export function redactEmail(email?: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '••@••';
  return '•••@' + email.slice(at + 1);
}

/** Remove forbidden keys and clamp value sizes. Recursive, shallow-typed. */
export function sanitiseMetadata(raw: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (v == null) { out[k] = null; continue; }
    if (typeof v === 'string') {
      out[k] = v.length > 200 ? v.slice(0, 200) + '…' : v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 16);
    } else if (typeof v === 'object') {
      // One level deep — flatten with prefixed keys.
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (FORBIDDEN_KEYS.has(k2)) continue;
        if (typeof v2 === 'string') out[`${k}.${k2}`] = v2.length > 200 ? v2.slice(0, 200) + '…' : v2;
        else if (typeof v2 === 'number' || typeof v2 === 'boolean') out[`${k}.${k2}`] = v2;
        // skip nested objects / arrays — keep the audit log flat
      }
    }
  }
  return out;
}

/**
 * Write an audit log row. Never throws.
 *
 * Invoke this AFTER the primary action has committed. Failures here must
 * not roll back legitimate work.
 */
export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  try {
    const db = getFirestore();
    await db.collection('auditLogs').add({
      action:      params.action,
      actorUid:    params.actor.uid,
      actorEmail:  params.actor.email ?? null,
      targetType:  params.target?.type ?? null,
      targetId:    params.target?.id ?? null,
      result:      params.result ?? 'success',
      metadata:    sanitiseMetadata(params.metadata),
      createdAt:   FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Deliberately swallow. Surfacing in logs only.
    console.error('[auditLog] write failed', {
      action: params.action,
      actorUid: params.actor.uid,
      error: (e as Error)?.message,
    });
  }
}
