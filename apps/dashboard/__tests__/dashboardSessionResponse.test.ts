import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
  createSessionCookie: vi.fn(),
}));
vi.mock('../lib/firebase-admin', () => ({ adminAuth: auth }));

import { clearDashboardSession, exchangeDashboardSession } from '../lib/dashboardSessionResponse';

function request(body: unknown) {
  return new Request('https://business.offlinesms.com/api/business/session', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('dashboard session exchange', () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it('enforces access before issuing the host-only cookie', async () => {
    auth.verifyIdToken.mockResolvedValue({ uid: 'test-user', role: 'organization_admin' });
    const denied = await exchangeDashboardSession(request({ idToken: 'test-token' }), () => 'organization_access_required');
    expect(denied.status).toBe(403);
    expect(denied.headers.get('set-cookie')).toBeNull();
    expect(auth.createSessionCookie).not.toHaveBeenCalled();

    auth.createSessionCookie.mockResolvedValue('test-session');
    const allowed = await exchangeDashboardSession(request({ idToken: 'test-token' }), () => null);
    expect(auth.verifyIdToken).toHaveBeenCalledWith('test-token', true);
    const cookie = allowed.headers.get('set-cookie');
    expect(cookie).toContain('__session=test-session');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=lax');
    expect(cookie).not.toMatch(/Domain=/i);
    expect(clearDashboardSession().headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('rejects missing tokens before checking claims', async () => {
    const response = await exchangeDashboardSession(request(null), () => null);
    expect(response.status).toBe(400);
    expect(auth.verifyIdToken).not.toHaveBeenCalled();
  });
});
