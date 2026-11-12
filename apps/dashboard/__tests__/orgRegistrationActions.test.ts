import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ verify: vi.fn() }));
const service = vi.hoisted(() => ({ approve: vi.fn(), reject: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session-cookie' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/session', () => ({ verifySession: session.verify }));
vi.mock('../lib/orgRegistration', () => ({ approveRegistration: service.approve, rejectRegistration: service.reject }));

import { reviewOrganizationRegistration } from '../lib/orgRegistrationActions';

const reviewer = { uid: 'reviewer', email: 'reviewer@example.test', claims: {} };

describe('organization registration review', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it.each(['organization_admin', 'support_agent', 'auditor', 'bootstrap_admin'])('refuses the %s role', async role => {
    session.verify.mockResolvedValue({ state: 'authorized', role, user: reviewer });
    expect(await reviewOrganizationRegistration('candidate', 'approve', null, new FormData())).toHaveProperty('error');
    expect(service.approve).not.toHaveBeenCalled();
    expect(service.reject).not.toHaveBeenCalled();
  });

  it('validates the decision and approval limit before attempting an approval', async () => {
    session.verify.mockResolvedValue({ state: 'authorized', role: 'super_admin', user: reviewer });
    const form = new FormData();
    form.set('monthlyMessageLimit', '-1');
    expect(await reviewOrganizationRegistration('candidate', 'approve', null, form)).toHaveProperty('error');
    expect(service.approve).not.toHaveBeenCalled();

    form.set('monthlyMessageLimit', '100');
    service.approve.mockResolvedValue({ success: true, organizationId: 'organization' });
    expect(await reviewOrganizationRegistration('candidate', 'approve', null, form)).toEqual({ success: true, organizationId: 'organization' });
    expect(service.approve).toHaveBeenCalledWith('candidate', reviewer, 100);
  });

  it('passes a rejection without granting any role', async () => {
    session.verify.mockResolvedValue({ state: 'authorized', role: 'super_admin', user: reviewer });
    service.reject.mockResolvedValue({ success: true });
    const form = new FormData();
    form.set('reason', ' Verification could not be completed. ');
    expect(await reviewOrganizationRegistration('candidate', 'reject', null, form)).toEqual({ success: true });
    expect(service.reject).toHaveBeenCalledWith('candidate', reviewer, 'Verification could not be completed.');
    expect(service.approve).not.toHaveBeenCalled();
  });
});
