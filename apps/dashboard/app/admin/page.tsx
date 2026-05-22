// Admin overview — server component.
// Dashboard counts are real Firestore aggregation queries.
// Large collections (users, wallets) are labelled approximate.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Users, Send, Coins, AlertCircle, MessageCircle, Wallet, CreditCard, LifeBuoy } from 'lucide-react';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getDashboardCounts } from '@/lib/adminData';
import RefreshButton from './RefreshButton';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fmt(n: number | null, approx = false): string {
  if (n === null) return '—';
  const formatted = n.toLocaleString('en-US');
  return approx ? `~${formatted}` : formatted;
}

export default async function AdminOverview() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin');

  let counts = await getDashboardCounts().catch(() => null);
  if (!counts) {
    counts = {
      totalUsers: null, activeGroups: null, smsBatchesToday: null,
      failedSmsBatches: null, openTickets: null, totalWallets: null, pendingPayments: null,
    };
  }

  const canViewPoints  = canDo(session.role, 'view:points');
  const canViewSupport = canDo(session.role, 'view:support');
  const canViewSms     = canDo(session.role, 'view:sms');
  const canViewUsers   = canDo(session.role, 'view:users');

  const cards = [
    {
      label: 'Total users',
      value: fmt(counts.totalUsers, true),
      note:  'Approximate',
      icon:  Users,
      cls:   'text-ink-700',
      href:  canViewUsers ? '/admin/users' : null,
    },
    {
      label: 'Active groups',
      value: fmt(counts.activeGroups),
      note:  null,
      icon:  MessageCircle,
      cls:   'text-emerald-600',
      href:  '/admin/groups',
    },
    ...(canViewSms ? [
      {
        label: 'SMS batches today',
        value: fmt(counts.smsBatchesToday),
        note:  null,
        icon:  Send,
        cls:   'text-blue-600',
        href:  '/admin/sms',
      },
      {
        label: 'Failed SMS batches',
        value: fmt(counts.failedSmsBatches),
        note:  null,
        icon:  AlertCircle,
        cls:   counts.failedSmsBatches ? 'text-red-600' : 'text-ink-400',
        href:  '/admin/sms',
      },
    ] : []),
    ...(canViewSupport ? [
      {
        label: 'Open tickets',
        value: fmt(counts.openTickets),
        note:  null,
        icon:  LifeBuoy,
        cls:   counts.openTickets ? 'text-amber-600' : 'text-ink-400',
        href:  '/admin/support',
      },
    ] : []),
    ...(canViewPoints ? [
      {
        label: 'Wallets',
        value: fmt(counts.totalWallets, true),
        note:  'Approximate',
        icon:  Wallet,
        cls:   'text-ink-700',
        href:  '/admin/points/wallets',
      },
      {
        label: 'Pending payments',
        value: fmt(counts.pendingPayments),
        note:  null,
        icon:  CreditCard,
        cls:   counts.pendingPayments ? 'text-amber-600' : 'text-ink-400',
        href:  '/admin/points/payments',
      },
    ] : []),
  ];

  return (
    <div className="p-7">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Overview</h1>
          <p className="text-sm text-ink-500 mt-0.5">Live counts from Firestore. Approximate values noted.</p>
        </div>
        <RefreshButton />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-6">
        {cards.map(c => {
          const inner = (
            <div className="bg-white rounded-2xl shadow-sh1 border border-ink-100 p-5 h-full">
              <div className="flex items-center gap-2 text-ink-500 text-xs font-bold uppercase tracking-wider mb-3">
                <c.icon size={14} /> {c.label}
              </div>
              <div className={`font-mono text-3xl font-extrabold tracking-tight ${c.cls}`}>{c.value}</div>
              {c.note && <div className="text-[10px] text-ink-400 mt-1">{c.note}</div>}
            </div>
          );
          return c.href ? (
            <a key={c.label} href={c.href} className="hover:scale-[1.01] transition-transform">
              {inner}
            </a>
          ) : (
            <div key={c.label}>{inner}</div>
          );
        })}
      </div>

      <div className="bg-white rounded-2xl shadow-sh1 border border-ink-100 p-5">
        <div className="text-sm font-extrabold tracking-tight text-ink-900 mb-1">Quick links</div>
        <p className="text-xs text-ink-500 mb-4">Navigate to key management areas.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Users',         href: '/admin/users' },
            { label: 'SMS batches',   href: '/admin/sms' },
            { label: 'Wallets',       href: '/admin/points/wallets' },
            { label: 'Roles',         href: '/admin/roles' },
            { label: 'Support',       href: '/admin/support' },
            { label: 'Audit log',     href: '/admin/audit' },
            { label: 'Settings',      href: '/admin/settings' },
            { label: 'Organizations', href: '/admin/organizations' },
          ].map(l => (
            <a key={l.label} href={l.href} className="text-sm text-primary font-semibold hover:underline">
              {l.label} →
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
