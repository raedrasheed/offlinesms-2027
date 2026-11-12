'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isPlatformAdmin } from './adminScope';
import { ORG_MONTHLY_LIMIT_MAX } from './orgMessagingValidation';
import { approveRegistration, rejectRegistration } from './orgRegistration';
import { isRecipientGroupId } from './recipientGroupValidation';
import { verifySession } from './session';

export type OrganizationRegistrationReviewState = null | { error: string } | { success: true; organizationId?: string };

export async function reviewOrganizationRegistration(
  id: string,
  decision: 'approve' | 'reject',
  _prev: OrganizationRegistrationReviewState,
  form: FormData,
): Promise<OrganizationRegistrationReviewState> {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized' || !isPlatformAdmin(session)) return { error: 'Platform administrator access required.' };
  if (!isRecipientGroupId(id) || (decision !== 'approve' && decision !== 'reject')) return { error: 'Invalid review request.' };

  const rawLimit = form.get('monthlyMessageLimit');
  const limit = rawLimit === null ? undefined : typeof rawLimit === 'string' && /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
  const reason = String(form.get('reason') ?? '').trim();
  if (decision === 'approve' && limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > ORG_MONTHLY_LIMIT_MAX)) {
    return { error: `Set a monthly limit between 1 and ${ORG_MONTHLY_LIMIT_MAX.toLocaleString()}.` };
  }
  if (decision === 'reject' && reason.length > 300) return { error: 'Keep the rejection reason within 300 characters.' };

  try {
    const result = decision === 'approve'
      ? await approveRegistration(id, session.user, limit)
      : await rejectRegistration(id, session.user, reason);
    if ('success' in result) {
      revalidatePath('/admin/organization-messaging/registrations');
      revalidatePath('/admin/organization-messaging');
    }
    return result;
  } catch {
    revalidatePath('/admin/organization-messaging/registrations');
    return { error: 'Could not complete the review. Reload the request and try again.' };
  }
}
