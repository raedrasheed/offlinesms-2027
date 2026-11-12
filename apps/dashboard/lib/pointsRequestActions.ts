'use server';

// Admin review of personal and organization points requests.
//
// A user submits a pointsRequests/{id} (status='pending') asking for a package.
// An admin approves — which credits the wallet with the requested points and
// writes a canonical 'admin_adjustment' transaction atomically — or rejects it.
// Gated by manage:wallets and idempotent: a request already approved/rejected
// is a no-op.

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { verifySession } from './session';
import { canDo } from './adminPermissions';
import { reviewPointsRequest } from './pointsRequestReview';

export type PointsRequestActionState = { error?: string; success?: boolean };

export async function reviewPointsRequestAction(
  requestId: string,
  outcome: 'approved' | 'rejected',
  reviewNote?: string,
): Promise<PointsRequestActionState> {
  const cookie = (await cookies()).get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:wallets')) {
    return { error: 'Permission denied.' };
  }
  let organizationId: string | null;
  try {
    ({ organizationId } = await reviewPointsRequest(requestId, outcome, session.user, reviewNote));
  } catch (e: unknown) {
    const code = e instanceof Error ? e.message : 'error';
    if (code === 'invalid-outcome')          return { error: 'Invalid outcome.' };
    if (code === 'invalid-request')          return { error: 'Invalid request.' };
    if (code === 'request-not-found')       return { error: 'Request not found.' };
    if (code === 'request-misconfigured')   return { error: 'Request has invalid points or wallet information.' };
    if (code === 'organization-inactive')   return { error: 'The organization must be active to receive points.' };
    if (code === 'wallet-misconfigured')    return { error: 'The wallet balance is invalid.' };
    if (code.startsWith('unexpected-status:')) return { error: `Request is ${code.split(':')[1]} and can’t be changed.` };
    return { error: 'Could not update the request.' };
  }

  revalidatePath('/admin/points/requests');
  if (organizationId) {
    revalidatePath('/business/points');
    revalidatePath('/points');
  }
  return { success: true };
}
