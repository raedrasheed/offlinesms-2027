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
    <div className="p-7">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Points</h1>
        <p className="text-sm text-ink-500 mt-0.5">Read-only overview — no wallet adjustment actions</p>
      </div>
      <div className="grid grid-cols-2 gap-4 max-w-2xl">
        {sections.map(s => (
          <Link
            key={s.href}
            href={s.href as any}
            className="bg-white border border-ink-100 rounded-2xl p-5 hover:border-primary hover:shadow-sh1 transition group"
          >
            <s.icon size={20} className="text-primary mb-3" />
            <div className="font-bold text-ink-900 group-hover:text-primary">{s.label}</div>
            <p className="text-xs text-ink-500 mt-1">{s.desc}</p>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-xs text-ink-400">
        Wallet adjustment, refunds, and package editing are deferred to a later phase.
      </p>
    </div>
  );
}
