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
import TicketAssignAction from './TicketAssignAction';
import { updateTicketStatus, assignSupportTicket } from '@/lib/supportActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

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
  const boundAssign = assignSupportTicket.bind(null, params.ticketId);

  return (
    <div className="p-6 max-w-2xl space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="flex items-center gap-2 text-[12px]">
        <Link href={'/admin/support' as any} className="hover:underline" style={{ color: '#5BB6DE' }}>← Support</Link>
        <span style={{ color: 'var(--c-text-4)' }}>/</span>
        <span className="font-semibold truncate" style={{ color: 'var(--c-text-3)' }}>{ticket.subject}</span>
      </div>

      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight">{ticket.subject}</h1>
          <p className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--c-text-4)' }}>{params.ticketId}</p>
        </div>
        <StatusBadge status={ticket.status} />
      </div>

      <div className="grid gap-5">
        <DetailCard title="Ticket details">
          <MetadataList items={[
            { label: 'Category',    value: <span className="capitalize">{ticket.category}</span> },
            { label: 'Status',      value: <StatusBadge status={ticket.status} /> },
            { label: 'Submitted by', value: (
              <Link href={`/admin/users/${ticket.createdBy}` as any} className="font-mono text-[11px] hover:underline" style={{ color: '#5BB6DE' }}>
                {ticket.createdBy}
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
            <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--c-text-2)' }}>{ticket.description}</p>
          </DetailCard>
        )}

        {canManage ? (
          <DetailCard title="Update status" subtitle="Changes are audit-logged.">
            <TicketStatusAction action={boundAction} currentStatus={ticket.status} />
          </DetailCard>
        ) : (
          <DetailCard title="Update status">
            <p className="text-sm" style={{ color: 'var(--c-text-3)' }}>Only support agents and super admins can update ticket status.</p>
          </DetailCard>
        )}

        {canManage ? (
          <DetailCard title="Assignment" subtitle="Assign to an admin UID. Changes are audit-logged.">
            <TicketAssignAction action={boundAssign} currentAssignee={ticket.assignedTo ?? null} />
          </DetailCard>
        ) : null}
      </div>
    </div>
  );
}
