import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifySession, reviewPointsRequest, revalidatePath } = vi.hoisted(() => ({
  verifySession: vi.fn(), reviewPointsRequest: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('../lib/session', () => ({ verifySession }));
vi.mock('../lib/pointsRequestReview', () => ({ reviewPointsRequest }));

import { reviewPointsRequestAction } from '../lib/pointsRequestActions';

const reviewer = { uid: 'reviewer', claims: {} };

describe('points request reviews', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it.each(['organization_admin', 'support_agent', 'auditor'])('refuses review by %s', async role => {
    verifySession.mockResolvedValue({ state: 'authorized', user: reviewer, role });
    await expect(reviewPointsRequestAction('request', 'approved')).resolves.toEqual({ error: 'Permission denied.' });
    expect(reviewPointsRequest).not.toHaveBeenCalled();
  });

  it('allows finance review and refreshes the organization points page', async () => {
    verifySession.mockResolvedValue({ state: 'authorized', user: reviewer, role: 'finance_admin' });
    reviewPointsRequest.mockResolvedValue({ organizationId: 'org' });
    await expect(reviewPointsRequestAction('request', 'approved')).resolves.toEqual({ success: true });
    expect(reviewPointsRequest).toHaveBeenCalledWith('request', 'approved', reviewer, undefined);
    expect(revalidatePath).toHaveBeenCalledWith('/admin/points/requests');
    expect(revalidatePath).toHaveBeenCalledWith('/business/points');
    expect(revalidatePath).toHaveBeenCalledWith('/points');
  });

  it('shows an approval error without treating the request as reviewed', async () => {
    verifySession.mockResolvedValue({ state: 'authorized', user: reviewer, role: 'super_admin' });
    reviewPointsRequest.mockRejectedValue(new Error('organization-inactive'));
    await expect(reviewPointsRequestAction('request', 'approved')).resolves.toEqual({
      error: 'The organization must be active to receive points.',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
