// Pure decision logic for reviewing a points request. No Firestore here so the
// idempotency + validation branching (the bug-prone part of the approve/reject
// transaction) is unit-testable in isolation. pointsRequestActions.ts applies
// the decision inside its transaction.

export type RequestStatus = 'pending' | 'approved' | 'rejected' | (string & {});
export type ReviewOutcome = 'approved' | 'rejected';

export type ReviewDecision =
  | { kind: 'noop' }                                                  // already terminal — idempotent
  | { kind: 'reject' }                                                // mark rejected (no credit)
  | { kind: 'credit'; points: number }                               // credit wallet + mark approved
  | { kind: 'error'; code: 'unexpected-status' | 'request-misconfigured' };

/**
 * Decide what an admin review should do, given the request's current state.
 *  - already approved/rejected → noop (idempotent; re-clicks/double-submits safe)
 *  - any non-pending, non-terminal status → error (unexpected)
 *  - reject → mark rejected, never credit
 *  - approve → credit the snapshot points, but only with a valid user + points
 */
export function decideReview(args: {
  status: RequestStatus;
  outcome: ReviewOutcome;
  points: number;
  userId?: string | null;
}): ReviewDecision {
  const { status, outcome, points, userId } = args;

  if (status === 'approved' || status === 'rejected') return { kind: 'noop' };
  if (status !== 'pending') return { kind: 'error', code: 'unexpected-status' };

  if (outcome === 'rejected') return { kind: 'reject' };

  // approve
  if (!userId || !Number.isFinite(points) || points <= 0) {
    return { kind: 'error', code: 'request-misconfigured' };
  }
  return { kind: 'credit', points };
}
