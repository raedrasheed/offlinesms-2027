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
 * Honest delivery statuses. Org messages are delivered as REAL in-app
 * conversation messages, so `delivered` and `read` are receipt-backed truths
 * reported by the recipient's device (never guessed):
 *   queued    → message created in the app pipeline; receipt still pending
 *   delivered → the recipient's app acknowledged delivery (receipt)
 *   read      → the recipient read it in the app (receipt)
 *   no_relay_for_country → recipient's country has no eligible relay, so the
 *     message is NOT delivered at all (in-app or SMS). Hard country block.
 * `sent`/`seen` remain unused.
 */
export const ORG_MESSAGE_STATUSES = ['accepted', 'queued', 'delivered', 'read', 'failed', 'unsupported_recipient', 'no_relay_for_country'] as const;
export type OrgMessageStatus = (typeof ORG_MESSAGE_STATUSES)[number];

// ─── SMS escalation policy (org default + per-request override) ─────────────
// Mirrors the OfflineSMS app's escalation audiences. After `delayMinutes`,
// recipients still matching the audience are escalated to SMS (billed to the
// organization's points wallet by the scheduled sweeper in functions/).

export const ESCALATION_AUDIENCES = ['unread_only', 'undelivered_only', 'everyone'] as const;
export type EscalationAudience = (typeof ESCALATION_AUDIENCES)[number];

export const ESCALATION_DELAY_MIN = 1;        // minutes
export const ESCALATION_DELAY_MAX = 1440;     // 24h

export interface EscalationPolicy {
  enabled:      boolean;
  delayMinutes: number;
  audience:     EscalationAudience;
}

export const DEFAULT_ESCALATION: EscalationPolicy = {
  enabled: true, delayMinutes: 5, audience: 'unread_only',
};

/** Validate dashboard escalation settings (org default). */
export function validateEscalationSettings(raw: {
  enabled?:      unknown;
  delayMinutes?: unknown;
  audience?:     unknown;
}): EscalationPolicy | { error: string } {
  const enabled = raw.enabled === true || raw.enabled === 'true';
  const delayNum = typeof raw.delayMinutes === 'number'
    ? raw.delayMinutes
    : Number((raw.delayMinutes ?? '').toString().trim());
  if (!Number.isFinite(delayNum) || !Number.isInteger(delayNum)
      || delayNum < ESCALATION_DELAY_MIN || delayNum > ESCALATION_DELAY_MAX) {
    return { error: `Check period must be a whole number of minutes (${ESCALATION_DELAY_MIN}–${ESCALATION_DELAY_MAX}).` };
  }
  const audience = (raw.audience ?? '').toString();
  if (!(ESCALATION_AUDIENCES as readonly string[]).includes(audience)) {
    return { error: 'SMS audience must be unread_only, undelivered_only, or everyone.' };
  }
  return { enabled, delayMinutes: delayNum, audience: audience as EscalationAudience };
}

/**
 * Resolve the effective policy for one send: the org default, then the
 * optional per-request override. Returns an error string for a bad override.
 */
export function resolveEscalationPolicy(
  orgDefault: Partial<EscalationPolicy> | null | undefined,
  override:   { enabled?: unknown; delayMinutes?: unknown; audience?: unknown } | null | undefined,
): EscalationPolicy | { error: string } {
  // Orgs that never configured escalation default to DISABLED (no surprise
  // SMS billing); new orgs are created with DEFAULT_ESCALATION.
  const base: EscalationPolicy = {
    enabled:      orgDefault?.enabled === true,
    delayMinutes: typeof orgDefault?.delayMinutes === 'number' ? orgDefault.delayMinutes : DEFAULT_ESCALATION.delayMinutes,
    audience:     (ESCALATION_AUDIENCES as readonly string[]).includes(orgDefault?.audience as string)
      ? (orgDefault!.audience as EscalationAudience) : DEFAULT_ESCALATION.audience,
  };
  if (override == null) return base;
  if (typeof override !== 'object') return { error: '"escalation" must be an object.' };

  const out = { ...base };
  if (override.enabled !== undefined) {
    if (typeof override.enabled !== 'boolean') return { error: '"escalation.enabled" must be a boolean.' };
    out.enabled = override.enabled;
  }
  if (override.delayMinutes !== undefined) {
    if (typeof override.delayMinutes !== 'number' || !Number.isInteger(override.delayMinutes)
        || override.delayMinutes < ESCALATION_DELAY_MIN || override.delayMinutes > ESCALATION_DELAY_MAX) {
      return { error: `"escalation.delayMinutes" must be an integer ${ESCALATION_DELAY_MIN}–${ESCALATION_DELAY_MAX}.` };
    }
    out.delayMinutes = override.delayMinutes;
  }
  if (override.audience !== undefined) {
    if (!(ESCALATION_AUDIENCES as readonly string[]).includes(override.audience as string)) {
      return { error: '"escalation.audience" must be unread_only, undelivered_only, or everyone.' };
    }
    out.audience = override.audience as EscalationAudience;
  }
  return out;
}

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
