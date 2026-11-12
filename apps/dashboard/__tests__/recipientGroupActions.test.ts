import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecipientGroupChange, RecipientGroupDefinitionChange } from '../lib/orgRecipientGroups';

const mocks = vi.hoisted(() => ({ session: vi.fn(), save: vi.fn(), saveDefinition: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session-cookie' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('../lib/session', () => ({ verifySession: mocks.session }));
vi.mock('../lib/orgRecipientGroups', () => ({
  getRecipientGroup: vi.fn(),
  saveRecipientGroupImport: vi.fn(),
  saveRecipientGroupChange: mocks.save,
  saveRecipientGroupDefinitionChange: mocks.saveDefinition,
}));

import { manageOrganizationRecipientGroup, manageOrganizationRecipients } from '../lib/orgMessagingActions';

const change: RecipientGroupChange = {
  type: 'delete',
  recipients: [{ name: 'Alex', phone: '+12025550123' }],
};
const definitionChange: RecipientGroupDefinitionChange = { type: 'delete', revision: '1700000000:0' };

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
    expect(await manageOrganizationRecipientGroup('school', 'parents', definitionChange)).toEqual({ error: 'Permission denied.' });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.saveDefinition).not.toHaveBeenCalled();
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

  it('revalidates the group and send pages only after a successful definition change', async () => {
    mocks.session.mockResolvedValue({
      state: 'authorized', role: 'organization_admin', user: { uid: 'admin', claims: { organizationId: 'school' } },
    });
    mocks.saveDefinition.mockResolvedValueOnce({ error: 'Refresh the group.' }).mockResolvedValueOnce({ success: true });

    expect(await manageOrganizationRecipientGroup('school', 'parents', definitionChange)).toEqual({ error: 'Refresh the group.' });
    expect(mocks.revalidate).not.toHaveBeenCalled();
    expect(await manageOrganizationRecipientGroup('school', 'parents', definitionChange)).toEqual({ success: true });
    expect(mocks.saveDefinition).toHaveBeenCalledWith('school', 'admin', 'parents', definitionChange);
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual([
      '/admin/organization-messaging', '/business', '/business/groups', '/business/send',
    ]);
  });
});
