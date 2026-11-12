import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type { OrgSendActionState } from '../lib/orgMessagingActions';

const form = vi.hoisted(() => ({
  state: null as OrgSendActionState,
  submit: vi.fn(),
  router: { refresh: vi.fn() },
}));
vi.mock('react-dom', () => ({
  useFormState: () => [form.state, form.submit],
  useFormStatus: () => ({ pending: false }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => form.router }));

import SendMessageForm from '../app/admin/organization-messaging/SendMessageForm';
const { create, act } = require('react-test-renderer');

const draft = { title: 'Meeting', body: 'Tomorrow at 10', recipients: '+970591234567' };
const action = async () => null;
const element = () => createElement(SendMessageForm, { action, groups: [], batchPath: '/activity' });
let root: any;

async function fillDraft() {
  for (const [name, value] of Object.entries(draft)) {
    await act(async () => root.root.findByProps({ name }).props.onChange({ target: { value } }));
  }
}

async function showResult(state: OrgSendActionState) {
  form.state = state;
  await act(async () => root.update(element()));
}

function expectDraft(expected: typeof draft) {
  for (const [name, value] of Object.entries(expected)) {
    expect(root.root.findByProps({ name }).props.value).toBe(value);
  }
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  form.state = null;
  form.router.refresh.mockClear();
  await act(async () => { root = create(element()); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

describe('organization message submission feedback', () => {
  const batch = {
    success: true as const,
    batchId: 'batch-1',
    total: 1,
    accepted: 0,
    failed: 0,
    unsupported: 0,
    noRelayForCountry: 1,
    status: 'failed',
    escalationScheduled: false,
    escalationDelayMinutes: 5,
    escalationAudience: 'unread_users_only',
  };

  it('reports coverage failure, preserves the draft, and links to the batch', async () => {
    await fillDraft();
    await showResult(batch);

    const alert = root.root.findByProps({ role: 'alert' });
    expect(alert.props.style.background).toBe('var(--c-error-bg)');
    expect(JSON.stringify(alert.children[1].children)).toContain('1 blocked by relay coverage');
    expect(alert.findByType('a').props.href).toBe('/activity/batch-1');
    expectDraft(draft);
  });

  it('keeps the draft on a server error and clears it after acceptance', async () => {
    await fillDraft();
    await showResult({ error: 'Could not submit the messages.' });
    expectDraft(draft);
    expect(form.router.refresh).not.toHaveBeenCalled();

    await showResult({ ...batch, accepted: 1, noRelayForCountry: 0, status: 'accepted' });
    expectDraft({ title: '', body: '', recipients: '' });
    expect(root.root.findByProps({ role: 'status' }).props.style.background).toBe('var(--c-success-bg)');
  });
});
