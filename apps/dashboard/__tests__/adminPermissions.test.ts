import { describe, it, expect } from 'vitest';
import { canDo, getCapabilities } from '../lib/adminPermissions';

describe('canDo', () => {
  it('super_admin has every capability', () => {
    expect(canDo('super_admin', 'view:users')).toBe(true);
    expect(canDo('super_admin', 'manage:users')).toBe(true);
    expect(canDo('super_admin', 'manage:wallets')).toBe(true);
    expect(canDo('super_admin', 'export:audit')).toBe(true);
    expect(canDo('super_admin', 'manage:notifications')).toBe(true);
  });

  it('support_agent cannot manage users or wallets', () => {
    expect(canDo('support_agent', 'manage:users')).toBe(false);
    expect(canDo('support_agent', 'manage:wallets')).toBe(false);
    expect(canDo('support_agent', 'manage:roles')).toBe(false);
  });

  it('support_agent can view and manage support', () => {
    expect(canDo('support_agent', 'view:support')).toBe(true);
    expect(canDo('support_agent', 'manage:support')).toBe(true);
  });

  it('finance_admin can manage wallets and packages', () => {
    expect(canDo('finance_admin', 'manage:wallets')).toBe(true);
    expect(canDo('finance_admin', 'manage:packages')).toBe(true);
  });

  it('finance_admin cannot manage users or roles', () => {
    expect(canDo('finance_admin', 'manage:users')).toBe(false);
    expect(canDo('finance_admin', 'manage:roles')).toBe(false);
  });

  it('auditor can view audit and export but never manage', () => {
    expect(canDo('auditor', 'view:audit')).toBe(true);
    expect(canDo('auditor', 'export:audit')).toBe(true);
    expect(canDo('auditor', 'manage:users')).toBe(false);
    expect(canDo('auditor', 'manage:wallets')).toBe(false);
    expect(canDo('auditor', 'manage:roles')).toBe(false);
    expect(canDo('auditor', 'manage:support')).toBe(false);
  });

  it('organization_admin can view but not manage notifications', () => {
    expect(canDo('organization_admin', 'view:notifications' as any)).toBe(false);
    expect(canDo('organization_admin', 'manage:notifications' as any)).toBe(false);
  });

  it('organization_admin can search globally but only export limited surfaces', () => {
    expect(canDo('organization_admin', 'search:global')).toBe(true);
    expect(canDo('organization_admin', 'export:groups')).toBe(true);
    expect(canDo('organization_admin', 'export:sms')).toBe(true);
    expect(canDo('organization_admin', 'export:users')).toBe(false);
    expect(canDo('organization_admin', 'export:audit')).toBe(false);
  });

  it('legacy_admin and bootstrap_admin behave like super_admin', () => {
    for (const cap of ['view:users', 'manage:wallets', 'export:audit', 'manage:notifications'] as const) {
      expect(canDo('legacy_admin', cap)).toBe(true);
      expect(canDo('bootstrap_admin', cap)).toBe(true);
    }
  });

  it('unknown role gets empty capabilities', () => {
    expect(canDo('nobody' as any, 'view:users')).toBe(false);
    expect(getCapabilities('nobody' as any)).toEqual([]);
  });
});
