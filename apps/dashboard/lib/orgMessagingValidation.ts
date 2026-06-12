// Pure validation for the Organization Messaging MVP. No Firebase imports so
// it's unit-testable in isolation (mirrors the project's *Logic / *Validation
// split used elsewhere). Server actions call these before touching Firestore.

export const ORG_STATUSES = ['active', 'suspended'] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const ORG_NAME_MAX = 120;
export const ORG_PASSWORD_MIN = 8;
export const ORG_MONTHLY_LIMIT_MAX = 1_000_000;

// Firebase Auth requires a minimum of 6; the project convention for admin
// accounts is stronger — at least 8 chars with a letter and a digit.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface OrgAccountInput {
  name:               string;
  email:              string;
  password:           string;
  monthlyMessageLimit: number;
  status:             OrgStatus;
}

/**
 * Validate + normalise a "create organization account" payload. Returns the
 * cleaned input, or an error code string used verbatim as the UI error.
 */
export function validateOrgAccountInput(raw: {
  name?:                string | null;
  email?:               string | null;
  password?:            string | null;
  monthlyMessageLimit?: string | number | null;
  status?:              string | null;
}): OrgAccountInput | { error: string } {
  const name = (raw.name ?? '').trim();
  if (!name) return { error: 'Organization name is required.' };
  if (name.length > ORG_NAME_MAX) return { error: `Name must be ${ORG_NAME_MAX} characters or less.` };

  const email = (raw.email ?? '').trim().toLowerCase();
  if (!email) return { error: 'Admin email is required.' };
  if (!EMAIL_RE.test(email)) return { error: 'Enter a valid admin email address.' };

  const password = raw.password ?? '';
  if (!password) return { error: 'Admin password is required.' };
  if (password.length < ORG_PASSWORD_MIN) {
    return { error: `Password must be at least ${ORG_PASSWORD_MIN} characters.` };
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return { error: 'Password must include at least one letter and one number.' };
  }

  const limitNum = typeof raw.monthlyMessageLimit === 'number'
    ? raw.monthlyMessageLimit
    : Number((raw.monthlyMessageLimit ?? '').toString().trim());
  if (!Number.isFinite(limitNum) || !Number.isInteger(limitNum) || limitNum <= 0) {
    return { error: 'Monthly message limit must be a positive whole number.' };
  }
  if (limitNum > ORG_MONTHLY_LIMIT_MAX) {
    return { error: `Monthly message limit must be ${ORG_MONTHLY_LIMIT_MAX.toLocaleString()} or less.` };
  }

  const status = (raw.status ?? 'active').trim();
  if (!(ORG_STATUSES as readonly string[]).includes(status)) {
    return { error: 'Status must be active or suspended.' };
  }

  return { name, email, password, monthlyMessageLimit: limitNum, status: status as OrgStatus };
}

/**
 * Derive a URL-ish slug from the org name + a short unique suffix so it satisfies
 * the existing organizations.slug shape without colliding. Suffix keeps it unique
 * without a read (the server action still treats a slug clash as an error).
 */
export function deriveOrgSlug(name: string, suffix: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const safeBase = base.length >= 2 ? base : 'org';
  return `${safeBase}-${suffix}`.slice(0, 40);
}

// ─── Message sending (shared by dashboard form + API endpoint) ───────────────

export const ORG_MSG_TITLE_MAX      = 80;
export const ORG_MSG_BODY_MAX       = 500;
export const ORG_MSG_MAX_RECIPIENTS = 500;

/**
 * Honest delivery statuses. The MVP has NO backend-only delivery primitive
 * (push needs app users with device tokens; SMS is conversation+points
 * coupled), so messages are never marked `sent`/`delivered` — they are
 * recorded and counted, real delivery is deferred.
 */
export const ORG_MESSAGE_STATUSES = ['accepted', 'queued', 'failed', 'unsupported_recipient'] as const;
export type OrgMessageStatus = (typeof ORG_MESSAGE_STATUSES)[number];

export type OrgBatchStatus = 'accepted' | 'partial' | 'failed';

export type OrgRecipient = { userId: string; phone?: never } | { phone: string; userId?: never };

/** UTC month bucket for quota counters, e.g. '2026-06'. */
export function usageMonthKey(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const PHONE_RE  = /^\+[0-9]{7,15}$/;          // E.164-ish: '+' then 7–15 digits
const USERID_RE = /^[A-Za-z0-9_-]{6,128}$/;   // Firebase uid shape

/** Classify one recipient line: E.164 phone, userId, or invalid (null). */
export function parseRecipientLine(line: string): OrgRecipient | null {
  const v = line.trim();
  if (!v) return null;
  const compactPhone = v.replace(/[\s()-]/g, '');
  if (compactPhone.startsWith('+')) {
    return PHONE_RE.test(compactPhone) ? { phone: compactPhone } : null;
  }
  // A digits-only line is a phone missing its '+' — reject it instead of
  // silently treating it as a userId (uids are never plain digit runs).
  if (/^[0-9]+$/.test(compactPhone)) return null;
  return USERID_RE.test(v) ? { userId: v } : null;
}

/**
 * Parse the dashboard textarea (one recipient per line) into recipients,
 * de-duplicating and reporting invalid lines.
 */
export function parseRecipientsText(text: string): { recipients: OrgRecipient[]; invalid: string[] } {
  const recipients: OrgRecipient[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const r = parseRecipientLine(line);
    if (!r) { invalid.push(line); continue; }
    const key = 'phone' in r && r.phone ? `p:${r.phone}` : `u:${(r as { userId: string }).userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(r);
  }
  return { recipients, invalid };
}

export interface OrgSendInput {
  title:      string;
  body:       string;
  recipients: OrgRecipient[];
}

/** Validate the dashboard send form (title/body/recipients textarea). */
export function validateOrgSendInput(raw: {
  title?:          string | null;
  body?:           string | null;
  recipientsText?: string | null;
}): OrgSendInput | { error: string } {
  const title = (raw.title ?? '').trim();
  if (!title) return { error: 'Title is required.' };
  if (title.length > ORG_MSG_TITLE_MAX) return { error: `Title must be ${ORG_MSG_TITLE_MAX} characters or less.` };

  const body = (raw.body ?? '').trim();
  if (!body) return { error: 'Body is required.' };
  if (body.length > ORG_MSG_BODY_MAX) return { error: `Body must be ${ORG_MSG_BODY_MAX} characters or less.` };

  const { recipients, invalid } = parseRecipientsText(raw.recipientsText ?? '');
  if (invalid.length > 0) {
    return { error: `Invalid recipient line${invalid.length === 1 ? '' : 's'}: ${invalid.slice(0, 3).join(', ')}${invalid.length > 3 ? '…' : ''}. Use a +E.164 phone or a user ID, one per line.` };
  }
  if (recipients.length === 0) return { error: 'Add at least one recipient (one per line).' };
  if (recipients.length > ORG_MSG_MAX_RECIPIENTS) {
    return { error: `At most ${ORG_MSG_MAX_RECIPIENTS} recipients per send.` };
  }

  return { title, body, recipients };
}
