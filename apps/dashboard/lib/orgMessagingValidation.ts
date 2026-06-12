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
