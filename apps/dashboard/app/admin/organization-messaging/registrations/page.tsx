import Link from 'next/link';
import type { Route } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import StatusBadge from '@/components/admin/StatusBadge';
import { EmptyState, ErrorState, PermissionState } from '@/components/state';
import { canDo } from '@/lib/adminPermissions';
import { isPlatformAdmin } from '@/lib/adminScope';
import { listOrganizationRegistrations, type OrganizationRegistrationRow } from '@/lib/orgRegistration';
import { reviewOrganizationRegistration } from '@/lib/orgRegistrationActions';
import { verifySession } from '@/lib/session';
import ReviewActions from './ReviewActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PATH = '/admin/organization-messaging/registrations';
const TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
] as const;
const BADGES = { pending: 'pending', approving: 'sending', approved: 'active', rejected: 'failed' };
const LABELS = { pending: 'Pending', approving: 'Approval in progress', approved: 'Approved', rejected: 'Rejected' };
const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

function SubmittedAt({ value }: { value: number | null }) {
  const date = value === null ? null : new Date(value);
  return date && Number.isFinite(date.getTime())
    ? <time dateTime={date.toISOString()}>{dateFormatter.format(date)} UTC</time>
    : '—';
}

function RegistrationRow({ row }: { row: OrganizationRegistrationRow }) {
  return (
    <li className="grid gap-4 rounded-xl border border-[var(--c-border)] bg-[var(--c-card)] p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 className="break-words font-bold" dir="auto">{row.name}</h2>
        <p className="break-all text-sm text-[var(--c-text-2)]">{row.email}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--c-text-2)]">
          <StatusBadge status={BADGES[row.status]} label={LABELS[row.status]} />
          <SubmittedAt value={row.createdAt} />
        </div>
      </div>
      <div className="min-w-0 md:text-right">
        {row.status === 'pending' || row.status === 'approving' ? (
          <ReviewActions
            approving={row.status === 'approving'}
            approve={reviewOrganizationRegistration.bind(null, row.id, 'approve')}
            reject={reviewOrganizationRegistration.bind(null, row.id, 'reject')}
          />
        ) : row.status === 'approved' && row.organizationId ? (
          <Link href={`/admin/organization-messaging?org=${encodeURIComponent(row.organizationId)}` as Route}
            className="inline-block rounded-md border border-[var(--c-border)] px-3 py-2 text-sm font-semibold text-[var(--c-text-2)] hover:bg-[var(--c-bg)]">
            Open organization
          </Link>
        ) : row.rejectionReason ? (
          <p className="whitespace-pre-wrap break-words text-sm text-[var(--c-text-2)]" dir="auto">{row.rejectionReason}</p>
        ) : null}
      </div>
    </li>
  );
}

export default async function OrganizationRegistrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized') redirect(`/login?next=${PATH}`);
  if (!isPlatformAdmin(session) || !canDo(session.role, 'manage:organization_messaging')) {
    return <div className="p-8"><PermissionState title="Super admin required" /></div>;
  }

  const { status } = await searchParams;
  const selected = TABS.find(tab => tab.value === status) ?? TABS[0];
  const rows = await listOrganizationRegistrations(selected.value).catch(() => null);

  return (
    <div className="max-w-5xl space-y-5 p-6 text-[var(--c-text)]">
      <header>
        <Link href={'/admin/organization-messaging' as Route} className="text-xs text-[var(--c-text-2)] hover:underline">
          ← Organization messaging
        </Link>
        <h1 className="mt-2 text-[22px] font-extrabold tracking-tight">Registration requests</h1>
        <p className="mt-1 text-sm text-[var(--c-text-2)]">Review organization requests after applicants verify their email address.</p>
      </header>

      <nav aria-label="Registration status" className="flex flex-wrap gap-2">
        {TABS.map(tab => (
          <Link key={tab.value} href={`${PATH}?status=${tab.value}` as Route}
            aria-current={selected.value === tab.value ? 'page' : undefined}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${selected.value === tab.value
              ? 'border-transparent bg-action-primary text-action-primaryFg'
              : 'border-[var(--c-border)] text-[var(--c-text-2)] hover:bg-[var(--c-card)]'}`}>
            {tab.label}
          </Link>
        ))}
      </nav>

      {rows === null ? (
        <ErrorState title="Could not load registration requests" className="[&_h2]:text-[var(--c-text)]"
          primaryAction={{ label: 'Try again', href: `${PATH}?status=${selected.value}` }} />
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${selected.value} requests`} className="[&_h2]:text-[var(--c-text)]" />
      ) : (
        <ul className="space-y-3" aria-label={`${selected.label} registration requests`}>
          {rows.map(row => <RegistrationRow key={row.id} row={row} />)}
        </ul>
      )}
    </div>
  );
}
