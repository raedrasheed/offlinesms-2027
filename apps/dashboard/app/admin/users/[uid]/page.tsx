// Admin user detail — server component.
// Shows profile metadata, wallet balance, group memberships, recent audit.
// Phone always masked. Email visibility depends on role.
// suspend/reactivate shown only to roles with manage:users.

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import {
  getUser, getUserWalletBalance, getUserGroupMemberships, getUserRecentAudit,
} from '@/lib/adminData';
import { maskPhone, maskEmail } from '@/lib/redaction';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import StatusBadge from '@/components/admin/StatusBadge';
import UserStatusAction from './UserStatusAction';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function UserDetailPage({ params }: { params: { uid: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/users');
  if (!canDo(session.role, 'view:users')) {
    return <div className="p-8"><PermissionState title="Users access required" /></div>;
  }

  const [user, wallet, groups, audit] = await Promise.all([
    getUser(params.uid),
    getUserWalletBalance(params.uid),
    getUserGroupMemberships(params.uid),
    getUserRecentAudit(params.uid),
  ]);

  if (!user) notFound();

  const canManage = canDo(session.role, 'manage:users');

  return (
    <div className="p-6 max-w-4xl space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center gap-2 text-[12px]">
        <Link href="/admin/users" className="hover:underline" style={{ color: '#5BB6DE' }}>← Users</Link>
        <span style={{ color: 'var(--c-text-4)' }}>/</span>
        <span className="font-semibold truncate" style={{ color: 'var(--c-text-3)' }}>{user.displayName ?? user.uid}</span>
      </div>

      <div className="grid gap-5">
        {/* Profile card */}
        <DetailCard
          title="Profile"
          subtitle={`UID: ${user.uid}`}
          actions={canManage ? <UserStatusAction uid={user.uid} currentStatus={user.status} /> : null}
        >
          <div className="flex items-center gap-4 mb-5">
            <div
              className="w-14 h-14 rounded-full font-extrabold text-xl grid place-items-center shrink-0"
              style={{ background: '#1F7BA822', color: '#5BB6DE' }}
            >
              {(user.displayName ?? user.uid).slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-lg font-extrabold" style={{ color: 'var(--c-text)' }}>{user.displayName ?? '—'}</p>
              <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>{user.username ? `@${user.username}` : 'No username'}</p>
              <div className="mt-1"><StatusBadge status={user.status} /></div>
            </div>
          </div>
          <MetadataList columns={2} items={[
            { label: 'Phone',            value: maskPhone(user.phoneNumber) },
            { label: 'Email',            value: maskEmail(user.email, session.role) },
            { label: 'Profile complete', value: user.profileCompleted ? 'Yes' : 'Pending' },
            { label: 'SMS opt-out',      value: user.smsOptOut ? 'Yes' : 'No' },
            { label: 'Joined',           value: user.createdAt },
            { label: 'Last updated',     value: user.updatedAt },
          ]} />
        </DetailCard>

        {/* Wallet summary */}
        <DetailCard title="Wallet" subtitle="Read-only balance summary">
          {wallet ? (
            <div className="flex gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--c-text-3)' }}>Balance</p>
                <p className="text-2xl font-extrabold" style={{ color: 'var(--c-text)' }}>
                  {wallet.balance} <span className="text-sm font-bold" style={{ color: 'var(--c-text-4)' }}>pts</span>
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--c-text-3)' }}>Reserved</p>
                <p className="text-2xl font-extrabold" style={{ color: 'var(--c-text)' }}>
                  {wallet.reserved} <span className="text-sm font-bold" style={{ color: 'var(--c-text-4)' }}>pts</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No wallet found.</p>
          )}
          <p className="text-xs mt-3" style={{ color: 'var(--c-text-4)' }}>Full transaction history is available in the Points module.</p>
        </DetailCard>

        {/* Groups */}
        <DetailCard title="Group memberships" subtitle={`${groups.length} group${groups.length !== 1 ? 's' : ''}`}>
          {groups.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Not a member of any groups.</p>
          ) : (
            <ul className="space-y-2">
              {groups.map(g => (
                <li key={g.id} className="flex items-center justify-between text-sm">
                  <Link href={`/admin/groups/${g.id}` as any} className="font-medium hover:underline truncate" style={{ color: 'var(--c-text)' }}>
                    {g.name ?? g.id.slice(0, 12)}
                  </Link>
                  <StatusBadge status={g.role} />
                </li>
              ))}
            </ul>
          )}
        </DetailCard>

        {/* Recent audit */}
        <DetailCard title="Recent activity" subtitle="Last 5 audit log entries by this user">
          {audit.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>No recent activity.</p>
          ) : (
            <ul className="space-y-2">
              {audit.map(a => (
                <li key={a.id} className="flex items-center justify-between text-xs gap-4">
                  <span className="font-mono truncate" style={{ color: 'var(--c-text-2)' }}>{a.action}</span>
                  <span className="whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{a.createdAt}</span>
                  <StatusBadge status={a.result} />
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs mt-3" style={{ color: 'var(--c-text-4)' }}>Full audit history is available in the Audit Log.</p>
        </DetailCard>
      </div>
    </div>
  );
}
