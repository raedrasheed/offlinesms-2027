import { describe, it, expect } from 'vitest';
import { decideReview } from '../lib/pointsRequestLogic';

describe('decideReview — points request approve/reject', () => {
  it('approve a pending request → credit the snapshot points', () => {
    expect(decideReview({ status: 'pending', outcome: 'approved', points: 3000, userId: 'u1' }))
      .toEqual({ kind: 'credit', points: 3000 });
  });

  it('reject a pending request → mark rejected, never credit', () => {
    expect(decideReview({ status: 'pending', outcome: 'rejected', points: 3000, userId: 'u1' }))
      .toEqual({ kind: 'reject' });
  });

  it('is idempotent: already approved/rejected → noop for any outcome', () => {
    for (const status of ['approved', 'rejected'] as const) {
      for (const outcome of ['approved', 'rejected'] as const) {
        expect(decideReview({ status, outcome, points: 3000, userId: 'u1' })).toEqual({ kind: 'noop' });
      }
    }
  });

  it('unexpected (non-pending, non-terminal) status → error', () => {
    expect(decideReview({ status: 'processing', outcome: 'approved', points: 3000, userId: 'u1' }))
      .toEqual({ kind: 'error', code: 'unexpected-status' });
    expect(decideReview({ status: '', outcome: 'approved', points: 3000, userId: 'u1' }))
      .toEqual({ kind: 'error', code: 'unexpected-status' });
  });

  it('approve with no user or non-positive/invalid points → misconfigured (never credits)', () => {
    expect(decideReview({ status: 'pending', outcome: 'approved', points: 3000, userId: null }))
      .toEqual({ kind: 'error', code: 'request-misconfigured' });
    expect(decideReview({ status: 'pending', outcome: 'approved', points: 0, userId: 'u1' }))
      .toEqual({ kind: 'error', code: 'request-misconfigured' });
    expect(decideReview({ status: 'pending', outcome: 'approved', points: -5, userId: 'u1' }))
      .toEqual({ kind: 'error', code: 'request-misconfigured' });
    expect(decideReview({ status: 'pending', outcome: 'approved', points: NaN, userId: 'u1' }))
      .toEqual({ kind: 'error', code: 'request-misconfigured' });
  });

  it('reject never validates points/user (a zero-point reject still rejects)', () => {
    expect(decideReview({ status: 'pending', outcome: 'rejected', points: 0, userId: null }))
      .toEqual({ kind: 'reject' });
  });
});
