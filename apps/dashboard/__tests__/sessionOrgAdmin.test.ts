// verifySession (Codex R6-1): an organization_admin claim without a usable
// organizationId is refused, so no page or action ever treats it as an
// unrestricted (platform-wide) admin.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const decoded = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock('../lib/firebase-admin', () => ({
  adminAuth: { verifySessionCookie: async () => decoded.current },
}));

import { verifySession } from '../lib/session';

describe('verifySession and organization admins', () => {
  beforeEach(() => { decoded.current = {}; });

  it('authorizes an organization_admin bound to an organization', async () => {
    decoded.current = { uid: 'u1', role: 'organization_admin', organizationId: 'org-acme' };
    expect(await verifySession('cookie')).toMatchObject({ state: 'authorized', role: 'organization_admin' });
  });

  it('refuses an organization_admin without an organization, by role or roles[]', async () => {
    for (const claims of [
      { role: 'organization_admin' },
      { role: 'organization_admin', organizationId: '' },
      { role: 'organization_admin', organizationId: '  ' },
      { role: 'organization_admin', organizationId: 42 },
      { roles: ['organization_admin'] },
    ]) {
      decoded.current = { uid: 'u1', ...claims };
      expect(await verifySession('cookie'), JSON.stringify(claims)).toMatchObject({ state: 'forbidden' });
    }
  });

  it('leaves platform roles unchanged', async () => {
    decoded.current = { uid: 'u1', role: 'super_admin' };
    expect(await verifySession('cookie')).toMatchObject({ state: 'authorized', role: 'super_admin' });
    decoded.current = { uid: 'u1', admin: true };
    expect(await verifySession('cookie')).toMatchObject({ state: 'authorized', role: 'legacy_admin' });
  });
});
