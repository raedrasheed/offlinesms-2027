import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  Users, Send, Coins, AlertCircle, MessageCircle,
  Wallet, CreditCard, LifeBuoy, TrendingUp, TrendingDown,
  Activity, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getDashboardCounts } from '@/lib/adminData';
import RefreshButton from './RefreshButton';
import { MessagesChart, DeliveryChart, PointsChart } from './DashboardCharts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fmt(n: number | null, approx = false): string {
  if (n === null) return '—';
  const formatted = n >= 1000
    ? n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
    : n.toLocaleString('en-US');
  return approx ? `~${formatted}` : formatted;
}

const CARD = 'var(--c-card)';
const BORDER = 'var(--c-border)';

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

  const kpis = [
    {
      label: 'Total users',
      value: fmt(counts.totalUsers, true),
      change: '+482 this week',
      trend: 'up',
      icon: Users,
      accent: '#1F7BA8',
      href: canViewUsers ? '/admin/users' : null,
    },
    {
      label: 'Active today',
      value: fmt(counts.activeGroups),
      change: '+12% vs yesterday',
      trend: 'up',
      icon: Activity,
      accent: '#22C55E',
      href: '/admin/groups',
    },
    ...(canViewSms ? [
      {
        label: 'SMS sent today',
        value: fmt(counts.smsBatchesToday),
        change: '+8.4% delivered',
        trend: 'up',
        icon: Send,
        accent: '#5BB6DE',
        href: '/admin/sms',
      },
      {
        label: 'Failed batches',
        value: fmt(counts.failedSmsBatches),
        change: counts.failedSmsBatches ? 'Needs attention' : 'All healthy',
        trend: counts.failedSmsBatches ? 'down' : 'up',
        icon: AlertCircle,
        accent: counts.failedSmsBatches ? '#EF4444' : '#22C55E',
        href: '/admin/sms',
      },
    ] : []),
    ...(canViewPoints ? [
      {
        label: 'Points spent',
        value: fmt(counts.totalWallets, true),
        change: '-4% last 7d',
        trend: 'down',
        icon: Coins,
        accent: '#F59E0B',
        href: '/admin/points/wallets',
      },
    ] : []),
    ...(canViewSupport ? [
      {
        label: 'Open tickets',
        value: fmt(counts.openTickets),
        change: counts.openTickets ? 'Action needed' : 'All resolved',
        trend: counts.openTickets ? 'down' : 'up',
        icon: LifeBuoy,
        accent: counts.openTickets ? '#F59E0B' : '#22C55E',
        href: '/admin/support',
      },
    ] : []),
  ];

  const recentBatches = [
    { id: '#SMS-4892', group: 'Brand refresh · Q3', recipients: 78, status: 'success', cost: '54 pts', time: '10:55' },
    { id: '#SMS-4891', group: 'Engineering all-hands', recipients: 122, status: 'sending', cost: '256 pts', time: '09:24' },
    { id: '#SMS-4890', group: 'Acme · Sales floor', recipients: 48, status: 'failed', cost: '0 pts', time: '09:11' },
    { id: '#SMS-4889', group: 'Boardupdate', recipients: 9, status: 'success', cost: '22 pts', time: '09:03' },
  ];

  const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
    success: { label: 'Sent',    bg: 'var(--c-success-bg)', text: '#22C55E' },
    sending: { label: 'Sending', bg: 'var(--c-warning-bg)', text: '#F59E0B' },
    failed:  { label: 'Failed',  bg: 'var(--c-error-bg)', text: '#EF4444' },
  };

  return (
    <div className="p-6 space-y-6" style={{ color: 'var(--c-text)' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-text-3)' }}>
            Admin / Dashboard
          </p>
          <h1 className="text-[22px] font-extrabold tracking-tight">
            Welcome back, Admin
          </h1>
        </div>
        <RefreshButton />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {kpis.map(k => {
          const inner = (
            <div
              className="rounded-xl p-4 h-full flex flex-col gap-2 transition hover:brightness-110"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-3)' }}>
                  {k.label}
                </span>
                <div
                  className="w-7 h-7 rounded-lg grid place-items-center shrink-0"
                  style={{ background: `${k.accent}22` }}
                >
                  <k.icon size={14} style={{ color: k.accent }} />
                </div>
              </div>
              <div className="font-mono text-[26px] font-extrabold tracking-tight leading-none" style={{ color: '#F1F5F9' }}>
                {k.value}
              </div>
              <div className="flex items-center gap-1 text-[11px]">
                {k.trend === 'up'
                  ? <TrendingUp size={11} style={{ color: '#22C55E' }} />
                  : <TrendingDown size={11} style={{ color: '#EF4444' }} />}
                <span style={{ color: k.trend === 'up' ? '#22C55E' : '#EF4444' }}>{k.change}</span>
              </div>
            </div>
          );
          return k.href
            ? <a key={k.label} href={k.href}>{inner}</a>
            : <div key={k.label}>{inner}</div>;
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <div className="lg:col-span-2"><MessagesChart /></div>
        <div className="lg:col-span-1"><DeliveryChart /></div>
        <div className="lg:col-span-2"><PointsChart /></div>
      </div>

      {/* Bottom row: recent batches + gateway health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Recent SMS escalations */}
        <div
          className="lg:col-span-2 rounded-xl overflow-hidden"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
            <p className="text-[13px] font-semibold">Recent SMS escalations</p>
            <a href="/admin/sms" className="text-[12px] font-semibold hover:underline" style={{ color: '#5BB6DE' }}>
              View all →
            </a>
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Batch', 'Group', 'Recipients', 'Status', 'Cost', 'Time'].map(h => (
                  <th key={h} className="px-5 py-2.5 text-left font-semibold" style={{ color: 'var(--c-text-4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentBatches.map((b, i) => {
                const s = statusConfig[b.status] ?? statusConfig.success;
                return (
                  <tr
                    key={b.id}
                    className="transition hover:bg-white/[0.03]"
                    style={i < recentBatches.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                  >
                    <td className="px-5 py-3 font-mono font-semibold" style={{ color: '#5BB6DE' }}>{b.id}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--c-text-2)' }}>{b.group}</td>
                    <td className="px-5 py-3 font-semibold" style={{ color: 'var(--c-text)' }}>{b.recipients}</td>
                    <td className="px-5 py-3">
                      <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold" style={{ background: s.bg, color: s.text }}>
                        {s.label}
                      </span>
                    </td>
                    <td className="px-5 py-3" style={{ color: 'var(--c-text-2)' }}>{b.cost}</td>
                    <td className="px-5 py-3" style={{ color: 'var(--c-text-4)' }}>{b.time}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Gateway health */}
        <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold">Gateway health</p>
            <a href="/admin/sms" className="text-[11px]" style={{ color: '#5BB6DE' }}>Open →</a>
          </div>

          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-400 shrink-0" />
            <span className="text-[15px] font-bold" style={{ color: '#22C55E' }}>Healthy</span>
          </div>

          <div className="space-y-3">
            {[
              { label: 'Queue',          value: '248', sub: 'msgs in flight' },
              { label: 'Delivery delay', value: '1.8s', sub: 'p95' },
              { label: 'Error rate',     value: '0.4%', sub: 'last hour' },
            ].map(m => (
              <div key={m.label} className="flex items-center justify-between">
                <div>
                  <p className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>{m.label}</p>
                  <p className="text-[10px]" style={{ color: 'var(--c-text-4)' }}>{m.sub}</p>
                </div>
                <span className="font-mono font-bold text-[16px]" style={{ color: 'var(--c-text)' }}>{m.value}</span>
              </div>
            ))}
          </div>

          <div className="pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
            <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--c-text-3)' }}>Quick actions</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'New batch',   href: '/admin/sms' },
                { label: 'Users',       href: '/admin/users' },
                { label: 'Wallets',     href: '/admin/points/wallets' },
                { label: 'Audit log',   href: '/admin/audit' },
              ].map(l => (
                <a
                  key={l.label}
                  href={l.href}
                  className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-center transition hover:brightness-110"
                  style={{ background: '#0A1828', color: '#5BB6DE', border: '1px solid #0E3A5A' }}
                >
                  {l.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
