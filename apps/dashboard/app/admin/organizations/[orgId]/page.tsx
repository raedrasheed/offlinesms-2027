// Admin organization detail — server component, read-only.
// Tabs: Overview, Users, Groups, Settings

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getOrganization, listOrgMembers, listOrgGroups } from '@/lib/adminData';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Tab = 'overview' | 'users' | 'groups' | 'settings';

export default async function OrgDetailPage({
  params,
  searchParams,
}: {
  params: { orgId: string };
  searchParams?: { tab?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/organizations');
  if (!canDo(session.role, 'view:organizations')) {
    return <div className="p-8"><PermissionState title="Organizations access required" /></div>;
  }

  const org = await getOrganization(params.orgId);
  if (!org) notFound();

  const tab = (searchParams?.tab ?? 'overview') as Tab;

  const [members, groups] = await Promise.all([
    tab === 'users' ? listOrgMembers(params.orgId) : Promise.resolve(null),
    tab === 'groups' ? listOrgGroups(params.orgId) : Promise.resolve(null),
  ]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'users',    label: 'Users' },
    { key: 'groups',   label: 'Groups' },
    { key: 'settings', label: 'Settings' },
  ];

  return (
    <div className="p-7 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={"/admin/organizations" as any} className="text-sm text-ink-500 hover:text-ink-900">← Organizations</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900 truncate">{org.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">{org.name}</h1>
          <p className="text-sm text-ink-500 font-mono">{org.slug}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={org.status} />
          {canDo(session.role, 'manage:organizations') && (
            <Link href={`/admin/organizations/${params.orgId}/edit` as any}
              className="px-3 py-1.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-dark transition">
              Edit
            </Link>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-ink-100">
        {tabs.map(t => (
          <Link
            key={t.key}
            href={`/admin/organizations/${params.orgId}?tab=${t.key}` as any}
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

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="grid gap-5">
          <DetailCard title="Organization details">
            <MetadataList columns={2} items={[
              { label: 'Name',       value: org.name },
              { label: 'Slug',       value: <span className="font-mono">{org.slug}</span> },
              { label: 'Status',     value: <StatusBadge status={org.status} /> },
              { label: 'Owner UID',  value: <span className="font-mono text-[11px]">{org.ownerUid}</span> },
              { label: 'Created',    value: org.createdAt },
              { label: 'Updated',    value: org.updatedAt },
            ]} />
          </DetailCard>
        </div>
      )}

      {tab === 'users' && (
        <DetailCard title="Members" subtitle="From organizations/{id}/members sub-collection">
          {!members || members.length === 0 ? (
            <p className="text-sm text-ink-500">No members found in sub-collection.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] font-bold text-ink-500 uppercase tracking-wide text-left">
                  <th className="pb-2 pr-4">UID</th>
                  <th className="pb-2 pr-4">Role</th>
                  <th className="pb-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m, i) => (
                  <tr key={m.uid} className={`border-t border-ink-100 ${i % 2 === 0 ? '' : 'bg-surface3/40'}`}>
                    <td className="py-2 pr-4">
                      <Link href={`/admin/users/${m.uid}` as any} className="font-mono text-xs text-primary hover:underline">
                        {m.uid.slice(0, 14)}…
                      </Link>
                    </td>
                    <td className="py-2 pr-4"><StatusBadge status={m.role} /></td>
                    <td className="py-2 text-xs text-ink-500">{m.joinedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DetailCard>
      )}

      {tab === 'groups' && (
        <DetailCard title="Groups">
          {!groups || groups.length === 0 ? (
            <p className="text-sm text-ink-500">No groups associated with this organization.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-[10px] font-bold text-ink-500 uppercase tracking-wide text-left">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Members</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={g.id} className={`border-t border-ink-100 ${i % 2 === 0 ? '' : 'bg-surface3/40'}`}>
                    <td className="py-2 pr-4">
                      <Link href={`/admin/groups/${g.id}` as any} className="font-semibold text-ink-900 hover:text-primary">
                        {g.name ?? '—'}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-xs text-ink-600">{g.memberCount}</td>
                    <td className="py-2 pr-4"><StatusBadge status={g.status} /></td>
                    <td className="py-2 text-xs text-ink-500">{g.createdAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DetailCard>
      )}

      {tab === 'settings' && (
        <DetailCard title="Settings" subtitle="Read-only organization settings">
          <MetadataList items={[
            { label: 'SMS escalation',  value: <span className={org.settings.smsEscalationEnabled ? 'text-emerald-600 font-bold' : 'text-ink-400'}>{org.settings.smsEscalationEnabled ? 'Enabled' : 'Disabled'}</span> },
            { label: 'Points',          value: <span className={org.settings.pointsEnabled ? 'text-emerald-600 font-bold' : 'text-ink-400'}>{org.settings.pointsEnabled ? 'Enabled' : 'Disabled'}</span> },
            { label: 'Default language', value: String(org.settings.defaultLanguage ?? '—') },
            { label: 'Timezone',         value: String(org.settings.timezone ?? '—') },
          ]} />
          <p className="text-xs text-ink-400 mt-4">Settings are managed via the Admin SDK or a future write action.</p>
        </DetailCard>
      )}
    </div>
  );
}
