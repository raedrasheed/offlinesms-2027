import type { AdminRole } from './session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';

const EMAIL_FULL_ROLES = new Set<RoleKey>(['super_admin', 'legacy_admin', 'bootstrap_admin', 'support_agent']);

export function maskPhone(phone?: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '•••';
  const last4 = digits.slice(-4);
  return `+${'•'.repeat(Math.max(digits.length - 4, 3))} ${last4}`;
}

export function maskEmail(email?: string | null, role?: RoleKey): string {
  if (!email) return '—';
  if (role && EMAIL_FULL_ROLES.has(role)) return email;
  const at = email.indexOf('@');
  if (at <= 0) return '•••@••';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local[0]}•${domain}`;
  return `${local[0]}${'•'.repeat(Math.min(local.length - 2, 4))}${local.slice(-1)}${domain}`;
}

export function safeDate(ts: any): string {
  const d: Date | null = ts?.toDate?.() ?? (
    typeof ts === 'object' && ts?._seconds ? new Date(ts._seconds * 1000) : null
  );
  if (!d || isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function safeUserSummary(doc: Record<string, any>, role?: RoleKey) {
  return {
    uid:              doc.id as string,
    displayName:      (doc.displayName as string | null) ?? null,
    username:         (doc.username as string | null) ?? null,
    email:            maskEmail(doc.email as string | null, role),
    phone:            maskPhone(doc.phoneNumber as string | null),
    status:           (doc.status as string | null) ?? 'active',
    profileCompleted: doc.profileCompleted === true,
    smsOptOut:        doc.smsOptOut === true,
    createdAt:        safeDate(doc.createdAt),
    updatedAt:        safeDate(doc.updatedAt),
  };
}
