import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ session: vi.fn(), getGroup: vi.fn(), submit: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session-cookie' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/firebase-admin', () => ({ adminAuth: {}, adminDb: {} }));
vi.mock('../lib/session', () => ({ verifySession: mocks.session }));
vi.mock('../lib/orgMessagingService', () => ({ submitOrganizationMessageBatch: mocks.submit }));
vi.mock('../lib/orgRecipientGroups', () => ({
  getRecipientGroup: mocks.getGroup,
  saveRecipientGroupImport: vi.fn(),
  saveRecipientGroupChange: vi.fn(),
  saveRecipientGroupDefinitionChange: vi.fn(),
}));

import { previewOrganizationRecipientGroupMessages, sendOrganizationMessage } from '../lib/orgMessagingActions';

const group = {
  id: 'parents', name: 'Parents', revision: '1700000000:0',
  members: [
    { name: 'Sara', phone: '+12025550123', message: '  مرحبًا سارة  ' },
    { name: 'Omar', phone: '+12025550124' },
  ],
};

function sendForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    recipientGroupId: group.id,
    recipientGroupRevision: group.revision,
    useGroupMessages: 'true',
    title: 'School news',
    body: 'Shared message',
    ...overrides,
  })) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({
    state: 'authorized', role: 'organization_admin',
    user: { uid: 'admin', email: 'admin@example.com', claims: { organizationId: 'school' } },
  });
  mocks.getGroup.mockResolvedValue(group);
  mocks.submit.mockResolvedValue({
    ok: true, batchId: 'batch',
    summary: { total: 2, accepted: 2, failed: 0, unsupported: 0, batchStatus: 'accepted' },
    smsOnlyAccepted: 1, escalationScheduled: true, escalation: { delayMinutes: 5, audience: 'unread_only' },
  });
});

it('only previews Excel messages for groups within the caller’s organization scope', async () => {
  expect(await previewOrganizationRecipientGroupMessages('other-school', group.id)).toEqual({ error: 'Permission denied.' });
  expect(mocks.getGroup).not.toHaveBeenCalled();

  expect(await previewOrganizationRecipientGroupMessages('school', group.id)).toEqual({
    revision: group.revision,
    members: [{ ...group.members[0], message: 'مرحبًا سارة' }, group.members[1]],
  });
  expect(mocks.getGroup).toHaveBeenCalledWith('school', group.id);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('submits the Excel text and common fallback as individual items in the same batch', async () => {
  expect(await sendOrganizationMessage('school', null, sendForm())).toMatchObject({ success: true, smsOnlyAccepted: 1 });
  expect(mocks.submit).toHaveBeenCalledWith('school', [
    { recipient: { phone: '+12025550123' }, title: 'School news', body: 'مرحبًا سارة' },
    { recipient: { phone: '+12025550124' }, title: 'School news', body: 'Shared message' },
  ], { source: 'dashboard', userUid: 'admin', userEmail: 'admin@example.com' }, { recipientGroupName: group.name });
});

it('allows a blank common body when all recipients have a saved message', async () => {
  mocks.getGroup.mockResolvedValue({ ...group, members: [group.members[0]] });
  expect(await sendOrganizationMessage('school', null, sendForm({ body: '' }))).toMatchObject({ success: true });
  expect(mocks.submit.mock.calls[0][1]).toEqual([
    { recipient: { phone: '+12025550123' }, title: 'School news', body: 'مرحبًا سارة' },
  ]);
});

it('rejects stale previews, missing fallback text, and manually mixed recipients before sending', async () => {
  expect(await sendOrganizationMessage('school', null, sendForm({ recipientGroupRevision: '1699999999:0' })))
    .toEqual({ error: 'The group changed. Reload the Excel message preview before sending.' });
  expect(await sendOrganizationMessage('school', null, sendForm({ body: '  ' })))
    .toEqual({ error: 'Enter a common message for recipients without an Excel message.' });
  expect(await sendOrganizationMessage('school', null, sendForm({ recipients: '+12025550125' })))
    .toEqual({ error: 'Choose a group or enter recipients manually.' });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('ignores stored messages in regular group sends and requires explicit opt-in', async () => {
  expect(await sendOrganizationMessage('school', null, sendForm({ useGroupMessages: '', recipientGroupRevision: '' })))
    .toMatchObject({ success: true });
  expect(mocks.submit.mock.calls[0][1]).toEqual([
    { recipient: { phone: '+12025550123' }, title: 'School news', body: 'Shared message' },
    { recipient: { phone: '+12025550124' }, title: 'School news', body: 'Shared message' },
  ]);
});

it('sends once for matching duplicate phone entries and rejects conflicting saved text', async () => {
  const duplicate = { ...group.members[0], phone: '+1 (202) 555-0123' };
  mocks.getGroup.mockResolvedValue({ ...group, members: [...group.members, duplicate] });
  expect(await sendOrganizationMessage('school', null, sendForm())).toMatchObject({ success: true });
  expect(mocks.submit.mock.calls[0][1]).toHaveLength(2);

  mocks.submit.mockClear();
  mocks.getGroup.mockResolvedValue({ ...group, members: [...group.members, { ...duplicate, message: 'Different' }] });
  expect(await sendOrganizationMessage('school', null, sendForm()))
    .toEqual({ error: 'The selected group has different messages for the same phone number.' });
  expect(mocks.submit).not.toHaveBeenCalled();
});
