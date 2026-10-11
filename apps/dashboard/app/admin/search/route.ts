// Admin global search — GET /admin/search?q=<query>&type=<optional>
// Capability-aware: each collection gated by role-specific capability.
// Prefix search on indexed string fields; exact ID match for opaque IDs.
// Max 5 results per group, 50 total. No message bodies, no full phones.

import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { maskEmail, maskPhone, safeDate } from '@/lib/redaction';
import { checkRateLimit, rateLimitResponse, LIMITS } from '@/lib/rateLimit';
import { nameInfoFrom, userLabel } from '@/lib/userLabel';

export const runtime = 'nodejs';

const GROUP_LIMIT = 5;

export type SearchResult = {
  type: string;
  title: string;
  subtitle: string;
  href: string;
  status?: string;
};

export type SearchGroup = {
  label: string;
  results: SearchResult[];
};

function isLikelyId(q: string): boolean {
  return q.length >= 20 && /^[a-zA-Z0-9_-]+$/.test(q);
}

function prefix(q: string) {
  return q + '';
}

async function searchUsers(q: string, role: string): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const ql = q.toLowerCase();

  if (isLikelyId(q)) {
    const snap = await adminDb.collection('users').doc(q).get().catch(() => null);
    if (snap?.exists) {
      const d = snap.data()!;
      // F1 Phase C: email lives in users/{uid}/userPrivate/profile, not the public doc.
      const priv = (await snap.ref.collection('userPrivate').doc('profile').get()).data() ?? {};
      results.push({
        type:     'user',
        title:    userLabel(nameInfoFrom(d, snap.id), { uid: snap.id }),
        subtitle: maskEmail((priv.email as string | null) ?? null, role as any),
        href:     `/admin/users/${snap.id}`,
        status:   (d.status as string | null) ?? 'active',
      });
    }
    return results;
  }

  // Search by usernameLower (always indexed) and displayNameLower (indexed post-Phase 18).
  const [usernameSnap, displayNameSnap] = await Promise.all([
    adminDb.collection('users')
      .where('usernameLower', '>=', ql)
      .where('usernameLower', '<=', ql + '')
      .limit(GROUP_LIMIT)
      .get()
      .catch(() => null),
    adminDb.collection('users')
      .where('displayNameLower', '>=', ql)
      .where('displayNameLower', '<=', ql + '')
      .limit(GROUP_LIMIT)
      .get()
      .catch(() => null),
  ]);

  const seen = new Set<string>();
  for (const snap of [usernameSnap, displayNameSnap]) {
    if (!snap) continue;
    for (const d of snap.docs) {
      if (seen.has(d.id) || results.length >= GROUP_LIMIT) break;
      seen.add(d.id);
      const data = d.data();
      // F1 Phase C: email lives in users/{uid}/userPrivate/profile, not the public doc.
      const priv = (await d.ref.collection('userPrivate').doc('profile').get()).data() ?? {};
      results.push({
        type:     'user',
        title:    userLabel(nameInfoFrom(data, d.id), { uid: d.id }),
        subtitle: `${data.usernameLower ? `@${data.usernameLower}` : d.id} · ${maskEmail((priv.email as string | null) ?? null, role as any)}`,
        href:     `/admin/users/${d.id}`,
        status:   (data.status as string | null) ?? 'active',
      });
    }
  }
  return results;
}

async function searchOrganizations(q: string): Promise<SearchResult[]> {
  const ql = q.toLowerCase();
  const snap = await adminDb.collection('organizations')
    .where('slug', '>=', ql)
    .where('slug', '<=', prefix(ql))
    .limit(GROUP_LIMIT)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map(d => {
    const data = d.data();
    return {
      type:     'organization',
      title:    (data.name as string | null) ?? (data.slug as string | null) ?? d.id,
      subtitle: `slug: ${data.slug ?? '—'} · ${(data.status as string | null) ?? 'active'}`,
      href:     `/admin/organizations/${d.id}`,
      status:   (data.status as string | null) ?? 'active',
    };
  });
}

async function searchGroups(q: string): Promise<SearchResult[]> {
  const ql = q.toLowerCase();
  // Prefer nameLower (indexed post-Phase 18); fall back to case-sensitive name prefix.
  const snap = await adminDb.collection('conversations')
    .where('type', '==', 'group')
    .where('nameLower', '>=', ql)
    .where('nameLower', '<=', ql + '')
    .limit(GROUP_LIMIT)
    .get()
    .catch(() =>
      adminDb.collection('conversations')
        .where('type', '==', 'group')
        .where('name', '>=', q)
        .where('name', '<=', q + '')
        .limit(GROUP_LIMIT)
        .get()
        .catch(() => null)
    );
  if (!snap) return [];
  return snap.docs.map(d => {
    const data = d.data();
    const pids = Array.isArray(data.participantUids) ? data.participantUids : [];
    return {
      type:     'group',
      title:    (data.name as string | null) ?? d.id.slice(0, 12),
      subtitle: `${pids.length} members · ${(data.status as string | null) ?? 'active'}`,
      href:     `/admin/groups/${d.id}`,
      status:   (data.status as string | null) ?? 'active',
    };
  });
}

async function searchSmsBatches(q: string): Promise<SearchResult[]> {
  if (!isLikelyId(q)) return [];
  const snap = await adminDb.collection('smsBatches').doc(q).get().catch(() => null);
  if (!snap?.exists) return [];
  const data = snap.data()!;
  return [{
    type:     'sms_batch',
    title:    `Batch ${snap.id.slice(0, 12)}…`,
    subtitle: `${data.status ?? '—'} · ${data.totalCount ?? 0} recipients`,
    href:     `/admin/sms/${snap.id}`,
    status:   (data.status as string | null) ?? 'unknown',
  }];
}

async function searchWallets(q: string): Promise<SearchResult[]> {
  if (!isLikelyId(q)) return [];
  const snap = await adminDb.collection('wallets').doc(q).get().catch(() => null);
  if (!snap?.exists) return [];
  const data = snap.data()!;
  return [{
    type:     'wallet',
    title:    `Wallet ${snap.id.slice(0, 12)}…`,
    subtitle: `${data.balance ?? 0} pts balance · ${data.status ?? 'active'}`,
    href:     `/admin/points/wallets/${snap.id}`,
    status:   (data.status as string | null) ?? 'active',
  }];
}

async function searchPayments(q: string): Promise<SearchResult[]> {
  if (!isLikelyId(q)) return [];
  const snap = await adminDb.collection('payments').doc(q).get().catch(() => null);
  if (!snap?.exists) return [];
  const data = snap.data()!;
  return [{
    type:     'payment',
    title:    `Payment ${snap.id.slice(0, 12)}…`,
    subtitle: `${data.totalPoints ?? 0} pts · ${data.status ?? '—'}`,
    href:     `/admin/points/payments`,
    status:   (data.status as string | null) ?? 'unknown',
  }];
}

async function searchTickets(q: string): Promise<SearchResult[]> {
  if (!isLikelyId(q)) return [];
  const snap = await adminDb.collection('tickets').doc(q).get().catch(() => null);
  if (!snap?.exists) return [];
  const data = snap.data()!;
  return [{
    type:     'ticket',
    title:    (data.subject as string | null) ?? `Ticket ${snap.id.slice(0, 12)}`,
    subtitle: `${data.category ?? '—'} · ${data.status ?? 'open'}`,
    href:     `/admin/support/${snap.id}`,
    status:   (data.status as string | null) ?? 'open',
  }];
}

async function searchAuditLogs(q: string): Promise<SearchResult[]> {
  const ql = q.toLowerCase();
  const snap = await adminDb.collection('auditLogs')
    .where('action', '>=', ql)
    .where('action', '<=', prefix(ql))
    .orderBy('action')
    .limit(GROUP_LIMIT)
    .get()
    .catch(() => null);
  if (!snap) return [];
  return snap.docs.map(d => {
    const data = d.data();
    return {
      type:     'audit',
      title:    (data.action as string | null) ?? '—',
      subtitle: `${data.result ?? '—'} · ${safeDate(data.createdAt)}`,
      href:     `/admin/audit`,
      status:   (data.result as string | null) ?? 'success',
    };
  });
}

export async function GET(request: Request) {
  const sessionCookie = cookies().get('__session')?.value;
  const session = await verifySession(sessionCookie);
  if (session.state !== 'authorized') {
    return NextResponse.json({ groups: [] }, { status: 401 });
  }
  if (!canDo(session.role, 'search:global')) {
    return NextResponse.json({ groups: [] }, { status: 403 });
  }

  const rl = checkRateLimit(`search:${session.user.uid}`, LIMITS.search);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs!);

  const url = new URL(request.url);
  const q    = (url.searchParams.get('q') ?? '').trim();
  const type = url.searchParams.get('type') ?? '';

  if (q.length < 2) {
    return NextResponse.json({ groups: [] });
  }

  const role = session.role;
  const tasks: Promise<SearchGroup | null>[] = [];

  const canViewUsers   = canDo(role, 'view:users');
  const canViewOrgs    = canDo(role, 'view:organizations');
  const canViewGroups  = canDo(role, 'view:groups');
  const canViewSms     = canDo(role, 'view:sms');
  const canViewPoints  = canDo(role, 'view:points');
  const canViewSupport = canDo(role, 'view:support');
  const canViewAudit   = canDo(role, 'view:audit');

  if (canViewUsers && (!type || type === 'user')) {
    tasks.push(
      searchUsers(q, role).then(r => r.length ? { label: 'Users', results: r } : null)
    );
  }
  if (canViewOrgs && (!type || type === 'organization')) {
    tasks.push(
      searchOrganizations(q).then(r => r.length ? { label: 'Organizations', results: r } : null)
    );
  }
  if (canViewGroups && (!type || type === 'group')) {
    tasks.push(
      searchGroups(q).then(r => r.length ? { label: 'Groups', results: r } : null)
    );
  }
  if (canViewSms && (!type || type === 'sms_batch')) {
    tasks.push(
      searchSmsBatches(q).then(r => r.length ? { label: 'SMS Batches', results: r } : null)
    );
  }
  if (canViewPoints && (!type || type === 'wallet')) {
    tasks.push(
      searchWallets(q).then(r => r.length ? { label: 'Wallets', results: r } : null)
    );
  }
  if (canViewPoints && (!type || type === 'payment')) {
    tasks.push(
      searchPayments(q).then(r => r.length ? { label: 'Payments', results: r } : null)
    );
  }
  if (canViewSupport && (!type || type === 'ticket')) {
    tasks.push(
      searchTickets(q).then(r => r.length ? { label: 'Support Tickets', results: r } : null)
    );
  }
  if (canViewAudit && (!type || type === 'audit')) {
    tasks.push(
      searchAuditLogs(q).then(r => r.length ? { label: 'Audit Actions', results: r } : null)
    );
  }

  const settled = await Promise.allSettled(tasks);
  const groups: SearchGroup[] = settled
    .filter((r): r is PromiseFulfilledResult<SearchGroup> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  return NextResponse.json({ groups }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
