// createOrganizationAccount is a platform action (Codex R6-1): it names the
// platform roles explicitly instead of trusting a missing organizationId.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const session = vi.hoisted(() => ({ current: { state: 'unauthenticated' } as Record<string, unknown> }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => ({ value: 'cookie' }) }) }));
vi.mock('../lib/firebase-admin', () => ({ adminAuth: {}, adminDb: {} }));
vi.mock('../lib/session', () => ({ verifySession: async () => session.current }));

import { createOrganizationAccount } from '../lib/orgMessagingActions';

const REFUSED = { error: 'Only platform super admins can create organization accounts.' };
const as = (role: string, claims: Record<string, unknown> = {}) =>
  ({ state: 'authorized', role, user: { uid: 'u1', email: 'a@example.com', claims } });

describe('createOrganizationAccount', () => {
  beforeEach(() => { session.current = { state: 'unauthenticated' }; });

  it('refuses every role that is not a platform admin', async () => {
    for (const s of [
      as('organization_admin', { organizationId: 'org-acme' }),
      as('bootstrap_admin'),
      as('support_agent'),
      as('auditor'),
      { state: 'unauthenticated' },
    ]) {
      session.current = s;
      expect(await createOrganizationAccount(null, new FormData()), JSON.stringify(s)).toEqual(REFUSED);
    }
  });

  it('lets super_admin and the legacy admin through to input validation', async () => {
    for (const s of [as('super_admin'), as('legacy_admin')]) {
      session.current = s;
      const out = await createOrganizationAccount(null, new FormData());
      expect(out).not.toEqual(REFUSED);
      expect(out).toHaveProperty('error');
    }
  });
});
