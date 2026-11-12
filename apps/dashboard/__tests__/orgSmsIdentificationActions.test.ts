import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ verifySession: vi.fn(), doc: vi.fn(), set: vi.fn(), audit: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session-cookie' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/session', () => ({ verifySession: mocks.verifySession }));
vi.mock('../lib/firebase-admin', () => ({
  adminAuth: {},
  adminDb: {
    collection: (name: string) => {
      if (name === 'organizations') return { doc: mocks.doc };
      if (name === 'auditLogs') return { add: mocks.audit };
      throw new Error(`Unexpected collection: ${name}`);
    },
  },
}));

import { updateOrgEscalationSettings } from '../lib/orgMessagingActions';

function settingsForm() {
  const form = new FormData();
  form.set('escalationEnabled', 'true');
  form.set('delayMinutes', '5');
  form.set('audience', 'everyone');
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.doc.mockReturnValue({ set: mocks.set });
  mocks.verifySession.mockResolvedValue({
    state: 'authorized', role: 'organization_admin', user: { uid: 'admin', claims: { organizationId: 'school' } },
  });
});

it.each([[true, false], [false, true]])(
  'saves organization and group identification settings independently (%s, %s)',
  async (showOrganizationName, showRecipientGroupName) => {
    const form = settingsForm();
    form.set('smsShowOrganizationName', String(showOrganizationName));
    form.set('smsShowRecipientGroupName', String(showRecipientGroupName));

    expect(await updateOrgEscalationSettings('school', null, form)).toEqual({ success: true });
    const smsIdentification = { showOrganizationName, showRecipientGroupName };
    expect(mocks.doc).toHaveBeenCalledWith('school');
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      smsIdentification,
      messagingEscalation: { enabled: true, delayMinutes: 5, audience: 'everyone' },
    }), { merge: true });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      targetId: 'school', metadata: expect.objectContaining({ smsIdentification }),
    }));
  },
);

it('refuses to update another organization or accept a partial identification form', async () => {
  const form = settingsForm();
  form.set('smsShowOrganizationName', 'false');

  expect(await updateOrgEscalationSettings('other-school', null, form)).toMatchObject({ error: expect.any(String) });
  expect(await updateOrgEscalationSettings('school', null, form)).toMatchObject({ error: expect.any(String) });
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});

it('lets an existing escalation form save without replacing identification settings', async () => {
  expect(await updateOrgEscalationSettings('school', null, settingsForm())).toEqual({ success: true });
  expect(mocks.set.mock.calls[0][0]).not.toHaveProperty('smsIdentification');
});
