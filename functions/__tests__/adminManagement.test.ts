import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminLockGroup } from '../src/admin/adminLockGroup';
import { setUserStatus } from '../src/admin/setUserStatus';

const { getUser, getDocument, update, writeAuditLog } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getDocument: vi.fn(),
  update: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ getUser }) }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ collection: () => ({ doc: () => ({ get: getDocument, update }) }) }),
  FieldValue: { serverTimestamp: () => 'server-time' },
}));
vi.mock('../src/lib/auditLog', () => ({ writeAuditLog }));

function userStatusRequest(claims: Record<string, unknown>, status = 'suspended', uid = 'target') {
  return {
    auth: { uid: 'operator', token: claims },
    data: { uid, status },
  } as Parameters<typeof setUserStatus.run>[0];
}

function groupLockRequest(claims: Record<string, unknown>) {
  return {
    auth: { uid: 'operator', token: claims },
    data: { conversationId: 'group', locked: true },
  } as Parameters<typeof adminLockGroup.run>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ customClaims: {} });
  getDocument.mockResolvedValue({ exists: true, data: () => ({ status: 'active' }) });
});

describe('admin user status', () => {
  it.each([{ role: 'super_admin' }, { roles: ['super_admin'] }, { admin: true }])(
    'allows platform administrators with %j to suspend a user',
    async claims => {
      await expect(setUserStatus.run(userStatusRequest(claims)))
        .resolves.toEqual({ ok: true, status: 'suspended' });
      expect(update).toHaveBeenCalledWith({ status: 'suspended', updatedAt: 'server-time' });
      expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'admin.user.setStatus', result: 'success', target: { type: 'user', id: 'target' },
      }));
    },
  );

  it('lets a super admin reactivate a suspended user', async () => {
    getDocument.mockResolvedValue({ exists: true, data: () => ({ status: 'suspended' }) });
    await expect(setUserStatus.run(userStatusRequest({ role: 'super_admin' }, 'active')))
      .resolves.toEqual({ ok: true, status: 'active' });
    expect(update).toHaveBeenCalledWith({ status: 'active', updatedAt: 'server-time' });
  });

  it.each([
    { role: 'organization_admin', roles: ['super_admin'] },
    { roles: ['support_agent', 'super_admin'] },
    { role: 'finance_admin' },
    { admin: 'true' },
    { permissions: { canAccessAdmin: true } },
    {},
  ])('denies %j without platform permissions', async claims => {
    await expect(setUserStatus.run(userStatusRequest(claims)))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(getUser).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('blocks self-suspension', async () => {
    await expect(setUserStatus.run(userStatusRequest({ role: 'super_admin' }, 'suspended', 'operator')))
      .rejects.toMatchObject({ message: 'cannot-modify-own-status' });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([{ role: 'super_admin' }, { roles: ['super_admin'] }])(
    'protects a super admin with %j from suspension',
    async customClaims => {
      getUser.mockResolvedValue({ customClaims });
      await expect(setUserStatus.run(userStatusRequest({ role: 'super_admin' })))
        .rejects.toMatchObject({ code: 'permission-denied', message: 'cannot-suspend-super-admin' });
      expect(update).not.toHaveBeenCalled();
    },
  );
});

describe('admin group lock', () => {
  it('accepts the super admin role without a legacy claim', async () => {
    getDocument.mockResolvedValue({ exists: true, data: () => ({ type: 'group' }) });
    await expect(adminLockGroup.run(groupLockRequest({ role: 'super_admin' })))
      .resolves.toEqual({ ok: true, status: 'locked' });
    expect(update).toHaveBeenCalledWith({ status: 'locked', updatedAt: 'server-time' });
  });

  it('denies a non-platform role', async () => {
    await expect(adminLockGroup.run(groupLockRequest({ role: 'support_agent' })))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(update).not.toHaveBeenCalled();
  });
});
