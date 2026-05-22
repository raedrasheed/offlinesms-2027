// Admin Points hub — server component. Links to sub-sections.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { PermissionState } from '@/components/state';
import { Wallet, ArrowLeftRight, CreditCard, Package } from 'lucide-react';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = '#131B27';
const BORDER = '#1A2437';

const sections = [
  { href: '/admin/points/wallets',      label: 'Wallets',       icon: Wallet,          desc: 'User wallet balances and reserved amounts.' },
  { href: '/admin/points/transactions', label: 'Transactions',  icon: ArrowLeftRight,  desc: 'All point transactions: purchases, SMS spend, transfers, refunds.' },
  { href: '/admin/points/payments',     label: 'Payments',      icon: CreditCard,       desc: 'In-app purchase records and payment statuses.' },
  { href: '/admin/points/packages',     label: 'Packages',      icon: Package,         desc: 'Points package catalog (read-only).' },
];

export default async function PointsHubPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points');
  if (!canDo(session.role, 'view:points')) {
    return <div className="p-8"><PermissionState title="Points access required" /></div>;
  }

  return (
    <div className="p-6 space-y-5" style={{ color: '#E2E8F2' }}>
      <div>
        <p className="text-[12px] font-medium mb-0.5" style={{ color: '#64748B' }}>Admin / Points</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">Points</h1>
        <p className="text-[13px] mt-0.5" style={{ color: '#64748B' }}>Read-only overview — no wallet adjustment actions</p>
      </div>
      <div className="grid grid-cols-2 gap-4 max-w-2xl">
        {sections.map(s => (
          <Link
            key={s.href}
            href={s.href as any}
            className="rounded-2xl p-5 transition hover:brightness-110 group"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <s.icon size={20} style={{ color: '#5BB6DE' }} className="mb-3" />
            <div className="font-bold" style={{ color: '#E2E8F2' }}>{s.label}</div>
            <p className="text-[12px] mt-1" style={{ color: '#64748B' }}>{s.desc}</p>
          </Link>
        ))}
      </div>
      <p className="text-[11px]" style={{ color: '#475569' }}>
        Wallet adjustment, refunds, and package editing are deferred to a later phase.
      </p>
    </div>
  );
}
