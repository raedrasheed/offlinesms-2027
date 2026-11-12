import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), submit: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session-cookie' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/session', () => ({ verifySession: mocks.session }));
vi.mock('../lib/businessPoints', () => ({ createBusinessPointsRequest: mocks.submit }));

import { requestBusinessPoints } from '../lib/businessPointsActions';

function requestForm() {
  const form = new FormData();
  form.set('packageId', 'package-a');
  form.set('note', ' For school alerts ');
  return form;
}

describe('Business points request authorization', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('takes the organization from the verified session and ignores client-supplied wallet and points', async () => {
    mocks.session.mockResolvedValue({
      state: 'authorized', role: 'organization_admin',
      user: { uid: 'admin-a', claims: { organizationId: 'tenant-a' } },
    });
    mocks.submit.mockResolvedValue({ success: true });
    const form = requestForm();
    form.set('organizationId', 'tenant-b');
    form.set('points', '100000');
    form.set('userId', 'orgsender_tenant-b');

    expect(await requestBusinessPoints(null, form)).toEqual({ success: true });
    expect(mocks.submit).toHaveBeenCalledWith('tenant-a', 'admin-a', 'package-a', 'For school alerts');
  });

  it.each([
    { state: 'unauthenticated' },
    { state: 'authorized', role: 'super_admin', user: { uid: 'platform', claims: {} } },
    { state: 'authorized', role: 'organization_admin', user: { uid: 'admin-a', claims: {} } },
  ])('refuses sessions without a valid Business organization scope', async session => {
    mocks.session.mockResolvedValue(session);
    expect(await requestBusinessPoints(null, requestForm())).toHaveProperty('error');
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
