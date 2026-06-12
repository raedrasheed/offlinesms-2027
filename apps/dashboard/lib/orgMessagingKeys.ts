// Organization Messaging — API key primitives. Pure + node:crypto only, so
// every rule here is unit-testable: format, hash-only persistence, and the
// sanitized status row that read helpers may expose.
//
// Security model:
//   • The raw key is `offmsg_live_<base64url(32 random bytes)>` — 256 bits of
//     entropy. Only its SHA-256 hex digest is ever persisted; a fast hash is
//     correct here (unlike passwords) because the secret is unguessably random.
//   • The raw key surfaces exactly once: in the generate action's return
//     value. It lives only in client component state — a refresh loses it.

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const API_KEY_PREFIX = 'offmsg_live_';

// prefix + 43 base64url chars (32 bytes). Used by the API endpoint to
// cheaply reject garbage before any Firestore lookup.
const API_KEY_RE = /^offmsg_live_[A-Za-z0-9_-]{43}$/;

export function isApiKeyFormat(raw: string): boolean {
  return API_KEY_RE.test(raw);
}

/** SHA-256 hex digest of the full raw key — the only stored representation. */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Generate a new key. Returns the one-time raw secret + the hash to store. */
export function generateApiKey(): { raw: string; hash: string } {
  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { raw, hash: hashApiKey(raw) };
}

/** Constant-time hash comparison (both args are sha256 hex strings). */
export function hashesMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

// ─── Sanitized status row (what dashboard reads may expose) ──────────────────

export type ApiKeyDocLike = {
  id:   string;
  data: Record<string, unknown>;   // raw Firestore doc data (includes keyHash)
};

export type ApiKeyStatusRow = {
  keyId:      string;
  status:     'active' | 'revoked';
  createdAt:  string;
  revokedAt:  string;
  lastUsedAt: string;
};

function safeDate(v: unknown): string {
  try {
    const d = (v as { toDate?: () => Date })?.toDate?.();
    return d ? d.toISOString() : '';
  } catch { return ''; }
}

function createdMs(d: Record<string, unknown>): number {
  return (d.createdAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
}

/**
 * Pick the org's display key (active first, else newest) and map it to the
 * sanitized status row. NEVER copies keyHash — this is the only shape the
 * dashboard read helper returns to pages/client components.
 */
export function pickApiKeyStatusRow(rows: ApiKeyDocLike[]): ApiKeyStatusRow | null {
  if (rows.length === 0) return null;
  const active = rows.find(r => r.data.status === 'active');
  const pick = active ?? [...rows].sort((a, b) => createdMs(b.data) - createdMs(a.data))[0];
  return {
    keyId:      pick.id,
    status:     pick.data.status === 'active' ? 'active' : 'revoked',
    createdAt:  safeDate(pick.data.createdAt),
    revokedAt:  safeDate(pick.data.revokedAt),
    lastUsedAt: safeDate(pick.data.lastUsedAt),
  };
}
