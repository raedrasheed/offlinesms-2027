// Public store-review credentials. They are an alias for ONE designated demo
// uid, never proof of ownership of this phone number. Keep these server-side.
import { createHash } from 'node:crypto';
import type { ReviewAccess } from './config';

export const FIXED_REVIEW_PHONE = '+970599999999';
export const FIXED_REVIEW_CODE = '123456';
export const FIXED_REVIEW_COUNTRY = 'PS';

/** Admin-only binding; no automatic expiry, phone lookup, or account creation. */
export function resolveFixedReviewAccess(raw: unknown): ReviewAccess | null {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  if (r?.enabled !== true || typeof r.uid !== 'string' || !r.uid || r.uid.length > 128) return null;
  const codeSalt = 'offlinesms-fixed-review-v1';
  return {
    phoneE164: FIXED_REVIEW_PHONE,
    codeSalt,
    codeHash: createHash('sha256').update(`${codeSalt}:${FIXED_REVIEW_CODE}`).digest('hex'),
    uid: r.uid,
    expiresAtMs: Number.MAX_SAFE_INTEGER,
  };
}
