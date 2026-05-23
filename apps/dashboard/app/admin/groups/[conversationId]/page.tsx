// Admin group detail — server component.
// Tabs: Overview, Members, Settings, SMS summary.
// No message bodies shown. Lock/unlock available to manage:groups roles.

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getGroup, listGroupMembers, getGroupSmsSummary } from '@/lib/adminData';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import StatusBadge from '@/components/admin/StatusBadge';
import GroupLockAction from './GroupLockAction';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Tab = 'overview' | 'members' | 'settings' | 'sms';

export default async function GroupDetailPage({
  params,
  searchParams,
}: {
  params: { conversationId: string };
  searchParams?: { tab?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/groups');
  if (!canDo(session.role, 'view:groups')) {
    return <div className="p-8"><PermissionState title="Groups access required" /></div>;
  }

  const group = await getGroup(params.conversationId);
  if (!group) notFound();

  const tab = (searchParams?.tab ?? 'overview') as Tab;
  const canManage = canDo(session.role, 'manage:groups');

  const [members, smsSummary] = await Promise.all([
    tab === 'members' ? listGroupMembers(params.conversationId) : Promise.resolve(null),
    tab === 'sms'     ? getGroupSmsSummary(params.conversationId) : Promise.resolve(null),
  ]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'members',  label: `Members (${group.memberCount})` },
    { key: 'settings', label: 'Settings' },
    { key: 'sms',      label: 'SMS summary' },
  ];

  return (
    <div className="p-7 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/groups" className="text-sm text-ink-500 hover:text-ink-900">← Groups</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900 truncate">{group.name ?? params.conversationId}</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">{group.name ?? '—'}</h1>
          <p className="text-xs text-ink-400 font-mono mt-0.5">{params.conversationId}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={group.status} />
          {canManage && (
            <GroupLockAction conversationId={params.conversationId} locked={group.locked} />
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-ink-100">
        {tabs.map(t => (
          <Link
            key={t.key}
            href={`/admin/groups/${params.conversationId}?tab=${t.key}` as any}
            className={`px-4 py-2 text-sm font-semibold rounded-t-lg border-b-2 transition ${
              tab === t.key
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-ink-500 hover:text-ink-900'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'overview' && (
        <DetailCard title="Group details">
          <MetadataList columns={2} items={[
            { label: 'Name',       value: group.name ?? '—' },
            { label: 'Status',     value: <StatusBadge status={group.status} /> },
            { label: 'Owner UID',  value: <span className="font-mono text-[11px]">{group.ownerUid ?? '—'}</span> },
            { label: 'Org',        value: group.organizationId ? <span className="font-mono text-[11px]">{group.organizationId.slice(0, 14)}</span> : '—' },
            { label: 'Members',    value: String(group.memberCount) },
            { label: 'Locked',     value: group.locked ? 'Yes' : 'No' },
            { label: 'Created',    value: group.createdAt },
            { label: 'Updated',    value: group.updatedAt },
          ]} />
        </DetailCard>
      )}

      {tab === 'members' && (
        <DetailCard title="Members" subtitle="Up to 200 members shown">
          {!members || members.length === 0 ? (
            <p className="text-sm text-ink-500">No members found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-[10px] font-bold text-ink-500 uppercase tracking-wide text-left">
                    <th className="pb-2 pr-4">User</th>
                    <th className="pb-2 pr-4">Role</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => (
                    <tr key={m.uid} className={`border-t border-ink-100 ${i % 2 === 0 ? '' : 'bg-surface3/40'}`}>
                      <td className="py-2.5 pr-4">
                        <Link href={`/admin/users/${m.uid}` as any} className="flex items-center gap-2 group">
                          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary font-bold text-xs grid place-items-center shrink-0">
                            {(m.displayName ?? m.uid).slice(0, 1).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-ink-900 group-hover:text-primary text-xs truncate">
                              {m.displayName ?? <span className="font-mono">{m.uid.slice(0, 10)}</span>}
                            </div>
                            {m.username && <div className="text-[10px] text-ink-400">@{m.username}</div>}
                          </div>
                        </Link>
                      </td>
                      <td className="py-2.5 pr-4"><StatusBadge status={m.role} /></td>
                      <td className="py-2.5 pr-4"><StatusBadge status={m.status} /></td>
                      <td className="py-2.5 text-xs text-ink-500">{m.joinedAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-ink-400 mt-3">
            Member management actions (promote/remove) are available in a later phase.
          </p>
        </DetailCard>
      )}

      {tab === 'settings' && (
        <DetailCard title="Settings" subtitle="Read-only group settings">
          <MetadataList items={[
            { label: 'Status',      value: <StatusBadge status={group.status} /> },
            { label: 'Locked',      value: group.locked ? 'Yes — only admins can send' : 'No' },
            { label: 'Description', value: group.description ?? '—' },
          ]} />
          <p className="text-xs text-ink-400 mt-4">Additional settings management is deferred to a later phase.</p>
        </DetailCard>
      )}

      {tab === 'sms' && (
        <DetailCard title="SMS escalation summary" subtitle="No message bodies shown">
          {smsSummary === null ? (
            <p className="text-sm text-ink-500">No SMS batches found for this group.</p>
          ) : (
            <div className="flex gap-8">
              <div>
                <p className="text-xs text-ink-500 font-semibold uppercase tracking-wide">Total batches</p>
                <p className="text-2xl font-extrabold text-ink-900 mt-1">{smsSummary.total}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500 font-semibold uppercase tracking-wide">Last batch</p>
                <p className="text-sm font-semibold text-ink-700 mt-1">{smsSummary.lastBatchAt}</p>
              </div>
            </div>
          )}
          <p className="text-xs text-ink-400 mt-3">Detailed SMS reports are in the SMS Gateway module.</p>
        </DetailCard>
      )}
    </div>
  );
}
