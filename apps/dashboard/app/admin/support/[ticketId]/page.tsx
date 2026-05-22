// Admin support ticket detail — server component.
// Shows ticket metadata and user-submitted description.
// Status update available for roles with manage:support.

import { cookies } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getSupportTicket } from '@/lib/adminData';
import { PermissionState } from '@/components/state';
import DetailCard from '@/components/admin/DetailCard';
import MetadataList from '@/components/admin/MetadataList';
import StatusBadge from '@/components/admin/StatusBadge';
import TicketStatusAction from './TicketStatusAction';
import { updateTicketStatus } from '@/lib/supportActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function TicketDetailPage({ params }: { params: { ticketId: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/support');
  if (!canDo(session.role, 'view:support')) {
    return <div className="p-8"><PermissionState title="Support access required" /></div>;
  }

  const ticket = await getSupportTicket(params.ticketId);
  if (!ticket) notFound();

  const canManage = canDo(session.role, 'manage:support');
  const boundAction = updateTicketStatus.bind(null, params.ticketId);

  return (
    <div className="p-7 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href={'/admin/support' as any} className="text-sm text-ink-500 hover:text-ink-900">← Support</Link>
        <span className="text-ink-300">/</span>
        <span className="text-sm font-semibold text-ink-900 truncate">{ticket.subject}</span>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-900">{ticket.subject}</h1>
          <p className="text-xs font-mono text-ink-400 mt-0.5">{params.ticketId}</p>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      <div className="grid gap-5">
        <DetailCard title="Ticket details">
          <MetadataList items={[
            { label: 'Category',    value: <span className="capitalize">{ticket.category}</span> },
            { label: 'Status',      value: <StatusBadge status={ticket.status} /> },
            { label: 'Submitted by', value: (
              <Link href={`/admin/users/${ticket.userId}` as any} className="font-mono text-[11px] text-primary hover:underline">
                {ticket.userId}
              </Link>
            )},
            { label: 'Assigned to', value: ticket.assignedTo ? (
              <span className="font-mono text-[11px]">{ticket.assignedTo}</span>
            ) : '—' },
            { label: 'Created',     value: ticket.createdAt },
            { label: 'Updated',     value: ticket.updatedAt },
          ]} />
        </DetailCard>

        {ticket.description && (
          <DetailCard title="Description" subtitle="User-submitted content">
            <p className="text-sm text-ink-700 whitespace-pre-wrap leading-relaxed">{ticket.description}</p>
          </DetailCard>
        )}

        {canManage ? (
          <DetailCard title="Update status" subtitle="Changes are audit-logged.">
            <TicketStatusAction action={boundAction} currentStatus={ticket.status} />
          </DetailCard>
        ) : (
          <DetailCard title="Update status">
            <p className="text-sm text-ink-500">Only support agents and super admins can update ticket status.</p>
          </DetailCard>
        )}
      </div>
    </div>
  );
}
