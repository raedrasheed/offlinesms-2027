import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipientGroupChange } from '../lib/orgRecipientGroups';

const mocks = vi.hoisted(() => ({ session: vi.fn(), save: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session-cookie' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/session', () => ({ verifySession: mocks.session }));
vi.mock('../lib/orgRecipientGroups', () => ({
  getRecipientGroup: vi.fn(),
  saveRecipientGroupImport: vi.fn(),
  saveRecipientGroupChange: mocks.save,
}));

import { manageOrganizationRecipients } from '../lib/orgMessagingActions';

const change: RecipientGroupChange = {
  type: 'delete',
  recipients: [{ name: 'Alex', phone: '+12025550123' }],
};

describe('recipient group management authorization', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it.each([
    { state: 'unauthenticated' },
    { state: 'authorized', role: 'organization_admin', user: { uid: 'admin', claims: {} } },
    { state: 'authorized', role: 'organization_admin', user: { uid: 'admin', claims: { organizationId: 'other' } } },
    { state: 'authorized', role: 'support_agent', user: { uid: 'support', claims: {} } },
  ])('rejects changes outside the caller’s management scope', async session => {
    mocks.session.mockResolvedValue(session);
    expect(await manageOrganizationRecipients('school', 'parents', change)).toEqual({ error: 'Permission denied.' });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'organization_admin', claims: { organizationId: 'school' } },
    { role: 'super_admin', claims: {} },
  ])('allows authorized administrators to update the selected group', async ({ role, claims }) => {
    mocks.session.mockResolvedValue({ state: 'authorized', role, user: { uid: 'admin', claims } });
    mocks.save.mockResolvedValue({ members: [] });

    expect(await manageOrganizationRecipients('school', 'parents', change)).toEqual({ members: [] });
    expect(mocks.save).toHaveBeenCalledWith('school', 'admin', 'parents', change);
  });
});
