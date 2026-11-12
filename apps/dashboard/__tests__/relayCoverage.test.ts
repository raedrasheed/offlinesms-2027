import { beforeEach, describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({
  getAssignment: vi.fn(),
  getSelected: vi.fn(),
  getNative: vi.fn(),
}));
vi.mock('../lib/firebase-admin', () => ({
  adminDb: {
    collection: (collection: string) => {
      if (collection === 'organizationRelayAssignments') return { doc: (id: string) => ({ get: () => data.getAssignment(id) }) };
      const query = { where: () => query, limit: () => query, get: data.getNative };
      return { doc: (id: string) => ({ get: () => data.getSelected(id) }), where: query.where };
    },
  },
}));

import { loadOrgRelayCoverage } from '../lib/relayCoverage';

const now = 200_000;
function doc(fields?: Record<string, unknown>) {
  return { exists: fields !== undefined, get: (key: string) => fields?.[key] };
}
function relay(fields: Record<string, unknown> = {}) {
  return doc({
    businessId: 'org-b', status: 'active', lastHeartbeatAt: { toMillis: () => now - 1000 },
    countryRoutingEnabled: true, allowedCountryCodes: ['PS'], ...fields,
  });
}

describe('dashboard organization relay coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    data.getAssignment.mockResolvedValue(doc());
    data.getNative.mockResolvedValue({ docs: [relay()] });
  });

  it('uses the native pool with no explicit assignment', async () => {
    const coverage = await loadOrgRelayCoverage('org-a', now, { useAssignedRelay: true });
    expect(coverage.assignedRelayDeviceId).toBeNull();
    expect(coverage.has('PS')).toBe(true);
    expect(data.getNative).toHaveBeenCalledOnce();
  });

  it('uses the selected device exclusively, even if owned by another organization', async () => {
    data.getAssignment.mockResolvedValue(doc({ relayDeviceId: 'shared-relay' }));
    data.getSelected.mockResolvedValue(relay({ businessId: 'org-b', allowedCountryCodes: ['JO'] }));
    const coverage = await loadOrgRelayCoverage('org-a', now, { useAssignedRelay: true });
    expect(coverage.assignedRelayDeviceId).toBe('shared-relay');
    expect(data.getSelected).toHaveBeenCalledWith('shared-relay');
    expect(coverage.has('JO')).toBe(true);
    expect(coverage.has('PS')).toBe(false);
    expect(data.getNative).not.toHaveBeenCalled();
  });

  it.each([
    doc(),
    relay({ status: 'paused' }),
    relay({ businessId: '' }),
    relay({ lastHeartbeatAt: { toMillis: () => now - 95_000 } }),
    relay({ countryRoutingEnabled: false }),
  ])('returns no coverage if the selected relay is unavailable', async selected => {
    data.getAssignment.mockResolvedValue(doc({ relayDeviceId: 'shared-relay' }));
    data.getSelected.mockResolvedValue(selected);
    const coverage = await loadOrgRelayCoverage('org-a', now, { useAssignedRelay: true });
    expect(coverage.has('PS')).toBe(false);
    expect(data.getNative).not.toHaveBeenCalled();
  });

  it('keeps native coverage for callers that do not opt in', async () => {
    const coverage = await loadOrgRelayCoverage('org-a', now);
    expect(coverage.has('PS')).toBe(true);
    expect(data.getAssignment).not.toHaveBeenCalled();
  });
});
