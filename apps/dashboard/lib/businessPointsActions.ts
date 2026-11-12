'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { organizationClaim } from './adminScope';
import { createBusinessPointsRequest } from './businessPoints';
import { isRecipientGroupId } from './recipientGroupValidation';
import { verifySession } from './session';

export type BusinessPointsActionState = null | { error: string } | { success: true };

export async function requestBusinessPoints(
  _previous: BusinessPointsActionState,
  form: FormData,
): Promise<BusinessPointsActionState> {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized' || session.role !== 'organization_admin') return { error: 'Organization administrator access required.' };
  const organizationId = organizationClaim(session.user.claims);
  if (!isRecipientGroupId(organizationId)) return { error: 'Organization access required.' };

  const packageId = form.get('packageId');
  if (!isRecipientGroupId(packageId)) return { error: 'Select a points package.' };
  const rawNote = form.get('note');
  if (rawNote !== null && (typeof rawNote !== 'string' || rawNote.length > 300)) {
    return { error: 'The note must contain at most 300 characters.' };
  }

  try {
    const result = await createBusinessPointsRequest(organizationId, session.user.uid, packageId, rawNote?.trim() || null);
    if ('success' in result) {
      revalidatePath('/business/points');
      revalidatePath('/points');
      revalidatePath('/admin/points/requests');
    }
    return result;
  } catch {
    return { error: 'Could not submit the request. Please try again.' };
  }
}
