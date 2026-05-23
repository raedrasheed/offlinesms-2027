'use server';

import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { verifySession } from './session';
import { canDo } from './adminPermissions';

export type SupportActionState = { error?: string; success?: boolean } | null;

const VALID_STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;


export async function updateTicketStatus(
  ticketId: string,
  _prev: SupportActionState,
  data: FormData,
): Promise<SupportActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:support')) {
    return { error: 'Permission denied.' };
  }

  const newStatus = (data.get('status') as string | null)?.trim() ?? '';
  if (!(VALID_STATUSES as readonly string[]).includes(newStatus)) {
    return { error: 'Invalid status.' };
  }

  const ticketSnap = await adminDb.collection('tickets').doc(ticketId).get();
  if (!ticketSnap.exists) return { error: 'Ticket not found.' };

  const prevStatus = (ticketSnap.data()?.status as string) ?? 'open';
  if (prevStatus === newStatus) return { success: true };

  await adminDb.collection('tickets').doc(ticketId).update({
    status:    newStatus,
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await adminDb.collection('auditLogs').add({
      action:     'support.ticket.status_changed',
      actorUid:   session.user.uid,
      actorEmail: session.user.email ?? null,
      targetType: 'support-ticket',
      targetId:   ticketId,
      result:     'success',
      metadata:   { previousStatus: prevStatus, newStatus },
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  return { success: true };
}

export async function assignSupportTicket(
  ticketId: string,
  _prev: SupportActionState,
  data: FormData,
): Promise<SupportActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:support')) {
    return { error: 'Permission denied.' };
  }

  const assigneeUid = (data.get('assigneeUid') as string | null)?.trim() || null;

  const ticketSnap = await adminDb.collection('tickets').doc(ticketId).get();
  if (!ticketSnap.exists) return { error: 'Ticket not found.' };

  const prevAssignee = (ticketSnap.data()?.assignedTo as string | null) ?? null;

  if (prevAssignee === assigneeUid) return { success: true };

  const action = assigneeUid === null
    ? 'support.ticket.unassigned'
    : prevAssignee === null
      ? 'support.ticket.assigned'
      : 'support.ticket.reassigned';

  await adminDb.collection('tickets').doc(ticketId).update({
    assignedTo: assigneeUid,
    updatedAt:  FieldValue.serverTimestamp(),
  });

  try {
    await adminDb.collection('auditLogs').add({
      action,
      actorUid:   session.user.uid,
      actorEmail: session.user.email ?? null,
      targetType: 'support-ticket',
      targetId:   ticketId,
      result:     'success',
      metadata:   { from: prevAssignee, to: assigneeUid },
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  return { success: true };
}
