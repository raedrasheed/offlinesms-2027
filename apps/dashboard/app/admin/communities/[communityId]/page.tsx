// Admin community detail — server component placeholder.

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getCommunity } from '@/lib/adminData';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import StatusBadge from '@/components/admin/StatusBadge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function CommunityDetailPage({ params }: { params: { communityId: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/communities');
  if (!canDo(session.role, 'view:communities')) {
    return <div className="p-8"><PermissionState title="Communities access required" /></div>;
  }

  let community: Awaited<ReturnType<typeof getCommunity>> = null;
  try {
    community = await getCommunity(params.communityId);
  } catch {
    community = null;
  }

  if (!community) notFound();

  return (
    <div className="p-7 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={"/admin/communities" as any} className="text-sm text-ink-500 hover:text-ink-900">← Communities</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900 truncate">{community.name ?? params.communityId}</span>
      </div>

      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900">{community.name ?? '—'}</h1>
        <StatusBadge status={community.status} />
      </div>

      <DetailCard title="Community details" subtitle="Read-only. Full management coming in a later phase.">
        <MetadataList columns={2} items={[
          { label: 'ID',           value: <span className="font-mono text-[11px]">{params.communityId}</span> },
          { label: 'Name',         value: community.name ?? '—' },
          { label: 'Status',       value: <StatusBadge status={community.status} /> },
          { label: 'Groups',       value: String(community.groupCount) },
          { label: 'Members',      value: String(community.memberCount) },
          { label: 'Created',      value: community.createdAt },
        ]} />
        <p className="text-xs text-ink-400 mt-4">
          Full community management (members, groups, settings, moderation) is deferred to a later phase.
        </p>
      </DetailCard>
    </div>
  );
}
