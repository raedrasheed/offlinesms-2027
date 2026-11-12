import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  session: { state: 'unauthenticated' } as any,
  docs: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ path: string; data?: Record<string, unknown> }>,
  coverage: vi.fn(async (_businessId: string, _now: number | undefined, options: { useAssignedRelay: boolean }) => ({
    has: () => true, assignedRelayDeviceId: options.useAssignedRelay ? 'relay-a' : null,
  })),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'session' }) }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../lib/session', () => ({ verifySession: async () => fake.session }));
vi.mock('../lib/relayCoverage', () => ({ loadOrgRelayCoverage: fake.coverage }));
vi.mock('../lib/firebase-admin', () => {
  type Ref = { path: string };
  const get = async (ref: Ref) => ({
    exists: fake.docs.has(ref.path),
    get: (field: string) => fake.docs.get(ref.path)?.[field],
  });
  function write(ref: Ref, data?: Record<string, unknown>) {
    fake.writes.push({ path: ref.path, data });
    if (data) fake.docs.set(ref.path, data);
    else fake.docs.delete(ref.path);
  }
  return { adminDb: {
    collection: (name: string) => ({
      doc: (id = 'audit-id') => {
        const ref = { path: `${name}/${id}` };
        return { ...ref, create: async (data: Record<string, unknown>) => write(ref, data) };
      },
    }),
    runTransaction: async (fn: any) => fn({
      get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
      set: write, create: write, delete: (ref: Ref) => write(ref),
    }),
  } };
});

import { sendRelayTestAction, setAssignedRelayDeviceAction } from '../lib/relayActions';

beforeEach(() => {
  fake.session = { state: 'authorized', role: 'super_admin', user: { uid: 'admin-1', claims: {} } };
  fake.docs = new Map([
    ['organizations/org-a', { name: 'Organization A' }],
    ['organizations/org-b', { name: 'Organization B' }],
    ['relayDevices/relay-a', { businessId: 'org-a', status: 'active' }],
    ['relayDevices/relay-paused', { businessId: 'org-a', status: 'paused' }],
    ['relayDevices/relay-revoked', { businessId: 'org-a', status: 'revoked' }],
  ]);
  fake.writes = [];
  fake.coverage.mockClear();
});

describe('platform relay assignment', () => {
  it('assigns a shared device without moving its original enrollment', async () => {
    expect(await setAssignedRelayDeviceAction('org-b', 'relay-a')).toEqual({ success: true });
    expect(fake.docs.get('organizationRelayAssignments/org-b')).toMatchObject({ relayDeviceId: 'relay-a', updatedByUid: 'admin-1' });
    expect(fake.docs.get('auditLogs/audit-id')).toMatchObject({
      action: 'relay.assignment.set', targetId: 'org-b',
      metadata: { previousDeviceId: null, assignedRelayDeviceId: 'relay-a' },
    });
    expect(fake.docs.get('relayDevices/relay-a')).toEqual({ businessId: 'org-a', status: 'active' });
    expect(fake.docs.has('organizationRelayAssignments/org-a')).toBe(false);
  });

  it('clears the override and leaves repeated submissions idempotent', async () => {
    await setAssignedRelayDeviceAction('org-b', 'relay-paused');
    fake.writes = [];
    expect(await setAssignedRelayDeviceAction('org-b', 'relay-paused')).toEqual({ success: true });
    expect(fake.writes).toHaveLength(0);
    expect(await setAssignedRelayDeviceAction('org-b', null)).toEqual({ success: true });
    expect(fake.docs.has('organizationRelayAssignments/org-b')).toBe(false);
    expect(fake.docs.get('auditLogs/audit-id')).toMatchObject({
      action: 'relay.assignment.cleared', metadata: { previousDeviceId: 'relay-paused', assignedRelayDeviceId: null },
    });
  });

  it('rejects non-platform roles, missing or revoked devices, and invalid paths', async () => {
    expect(await setAssignedRelayDeviceAction('org-b', 'relay-revoked')).toHaveProperty('error');
    expect(await setAssignedRelayDeviceAction('org-b', 'missing')).toHaveProperty('error');
    expect(await setAssignedRelayDeviceAction('missing', 'relay-a')).toHaveProperty('error');
    expect(await setAssignedRelayDeviceAction('org-b/sub', 'relay-a')).toHaveProperty('error');
    expect(await setAssignedRelayDeviceAction('org-b', 'relay-a/sub')).toHaveProperty('error');
    for (const role of ['organization_admin', 'support_agent', 'finance_admin', 'auditor', 'bootstrap_admin']) {
      fake.session = { state: 'authorized', role, user: { uid: 'user', claims: { organizationId: 'org-b' } } };
      expect(await setAssignedRelayDeviceAction('org-b', 'relay-a')).toHaveProperty('error');
    }
    expect(fake.writes).toHaveLength(0);
  });

  it('pins platform test jobs and preserves native test behavior for org managers', async () => {
    expect(await sendRelayTestAction('+970591234567', 'Test', 'org-b')).toEqual({ success: true });
    expect(fake.coverage).toHaveBeenLastCalledWith('org-b', undefined, { useAssignedRelay: true });
    expect(fake.writes.find(write => write.path.startsWith('relayJobs/'))?.data).toMatchObject({
      businessId: 'org-b', assignedDeviceId: 'relay-a', organizationRelayDeviceId: 'relay-a',
    });

    fake.writes = [];
    fake.session = { state: 'authorized', role: 'organization_admin', user: { uid: 'org-admin', claims: { organizationId: 'org-b' } } };
    expect(await sendRelayTestAction('+970591234567', 'Test', 'org-a')).toEqual({ success: true });
    expect(fake.coverage).toHaveBeenLastCalledWith('org-b', undefined, { useAssignedRelay: false });
    const nativeJob = fake.writes.find(write => write.path.startsWith('relayJobs/'))?.data;
    expect(nativeJob).toMatchObject({ businessId: 'org-b', assignedDeviceId: null });
    expect(nativeJob).not.toHaveProperty('organizationRelayDeviceId');
  });
});
