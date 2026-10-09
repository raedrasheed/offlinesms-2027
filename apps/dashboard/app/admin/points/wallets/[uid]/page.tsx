// Wallet detail page — server component.
// Shows wallet summary, masked user info, recent transactions, and freeze/unfreeze action.
// Balance adjustment is NOT available here by design.

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getWallet, getUser, listTransactions } from '@/lib/adminData';
import { maskEmail, maskPhone } from '@/lib/redaction';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import StatusBadge from '@/components/admin/StatusBadge';
import { userLabel } from '@/lib/userLabel';
import WalletFreezeAction from '../WalletFreezeAction';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function WalletDetailPage({ params }: { params: { uid: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/points/wallets');
  if (!canDo(session.role, 'view:points')) {
    return (
      <div className="p-8">
        <PermissionState title="Points access required" description="Your role does not include access to wallet details." />
      </div>
    );
  }

  const [wallet, user, transactions] = await Promise.all([
    getWallet(params.uid),
    getUser(params.uid).catch(() => null),
    listTransactions(undefined, params.uid).catch(() => []),
  ]);

  if (!wallet) notFound();

  const canFreeze = canDo(session.role, 'manage:wallets');
  const role = session.role;

  return (
    <div className="p-7 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/points/wallets' as any} className="text-sm text-ink-500 hover:text-ink-900">← Wallets</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900 truncate" title={params.uid}>{userLabel(user, { uid: params.uid })}</span>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">
            {userLabel(user, { uid: params.uid })}
          </h1>
          <p className="text-xs font-mono text-ink-400 mt-0.5">{params.uid}</p>
        </div>
        <StatusBadge status={wallet.status} />
      </div>

      <div className="grid gap-5">
        {/* Wallet summary */}
        <DetailCard title="Wallet summary">
          <MetadataList items={[
            { label: 'Balance',   value: <span className="font-mono font-bold text-ink-900">{wallet.balance} pts</span> },
            { label: 'Reserved',  value: <span className="font-mono text-amber-700">{wallet.reserved} pts</span> },
            { label: 'Available', value: <span className="font-mono text-emerald-700">{wallet.available} pts</span> },
            { label: 'Status',    value: <StatusBadge status={wallet.status} /> },
            { label: 'Updated',   value: wallet.updatedAt },
          ]} />
          <p className="text-[10px] text-ink-400 mt-3">Balance adjustment is not available from the admin dashboard.</p>
        </DetailCard>

        {/* User info */}
        {user && (
          <DetailCard title="User info">
            <MetadataList items={[
              { label: 'Display name', value: user.displayName ?? '—' },
              { label: 'Username',     value: user.username ? `@${user.username}` : '—' },
              { label: 'Email',        value: maskEmail(user.email, role) },
              { label: 'Phone',        value: maskPhone(user.phoneNumber) },
              { label: 'Account status', value: <StatusBadge status={user.status} /> },
              { label: 'Member since', value: user.createdAt },
            ]} />
            <div className="mt-3">
              <Link href={`/admin/users/${params.uid}` as any} className="text-xs text-primary font-semibold hover:underline">
                View full user profile →
              </Link>
            </div>
          </DetailCard>
        )}

        {/* Freeze / unfreeze */}
        {canFreeze ? (
          <DetailCard title="Wallet actions" subtitle="Status changes are audit-logged.">
            <div className="flex items-center gap-4">
              <WalletFreezeAction uid={params.uid} currentStatus={wallet.status} />
              <p className="text-xs text-ink-500">Only status changes are permitted. Balance is read-only.</p>
            </div>
          </DetailCard>
        ) : (
          <DetailCard title="Wallet actions">
            <p className="text-sm text-ink-500">Only finance admins and super admins can freeze or unfreeze wallets.</p>
          </DetailCard>
        )}

        {/* Recent transactions */}
        <DetailCard title="Recent transactions" subtitle="Up to 50 most recent">
          {transactions.length === 0 ? (
            <p className="text-sm text-ink-400">No transactions found.</p>
          ) : (
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="text-left text-[10px] font-bold text-ink-500 uppercase tracking-wide border-b border-ink-100">
                    <th className="px-2 py-2">Type</th>
                    <th className="px-2 py-2 text-right">Amount</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx, i) => (
                    <tr key={tx.id} className={`border-t border-ink-50 ${i % 2 === 0 ? '' : 'bg-surface3/30'}`}>
                      <td className="px-2 py-2 font-mono text-ink-700">{tx.type}</td>
                      <td className={`px-2 py-2 text-right font-mono font-bold ${
                        tx.direction === 'credit' ? 'text-emerald-700'
                        : tx.direction === 'debit' ? 'text-red-700'
                        : 'text-ink-900'
                      }`}>
                        {tx.direction === 'debit' ? '-' : tx.direction === 'credit' ? '+' : ''}{tx.amount}
                      </td>
                      <td className="px-2 py-2"><StatusBadge status={tx.status} /></td>
                      <td className="px-2 py-2 text-ink-400 whitespace-nowrap">{tx.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DetailCard>
      </div>
    </div>
  );
}
