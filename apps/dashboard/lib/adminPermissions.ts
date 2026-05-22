import type { AdminRole } from './session';

export type AdminCapability =
  | 'view:overview'
  | 'view:users'
  | 'manage:users'
  | 'view:organizations'
  | 'view:groups'
  | 'manage:groups'
  | 'view:calls'
  | 'view:sms'
  | 'view:points'
  | 'view:reports'
  | 'view:support'
  | 'view:roles'
  | 'view:settings'
  | 'view:audit'
  | 'view:communities';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';

const ROLE_CAPABILITIES: Record<RoleKey, readonly AdminCapability[]> = {
  super_admin: [
    'view:overview', 'view:users', 'manage:users',
    'view:organizations',
    'view:groups', 'manage:groups',
    'view:calls', 'view:sms', 'view:points', 'view:reports',
    'view:support', 'view:roles', 'view:settings', 'view:audit',
    'view:communities',
  ],
  organization_admin: [
    'view:overview', 'view:users',
    'view:organizations',
    'view:groups',
    'view:calls', 'view:reports', 'view:support', 'view:settings',
    'view:communities',
  ],
  support_agent: [
    'view:overview', 'view:users', 'view:support',
  ],
  finance_admin: [
    'view:overview', 'view:points', 'view:reports',
  ],
  auditor: [
    'view:overview', 'view:reports', 'view:audit',
  ],
  legacy_admin: [
    'view:overview', 'view:users', 'manage:users',
    'view:organizations',
    'view:groups', 'manage:groups',
    'view:calls', 'view:sms', 'view:points', 'view:reports',
    'view:support', 'view:roles', 'view:settings', 'view:audit',
    'view:communities',
  ],
  bootstrap_admin: [
    'view:overview', 'view:users', 'manage:users',
    'view:organizations',
    'view:groups', 'manage:groups',
    'view:calls', 'view:sms', 'view:points', 'view:reports',
    'view:support', 'view:roles', 'view:settings', 'view:audit',
    'view:communities',
  ],
};

export function getCapabilities(role: RoleKey): readonly AdminCapability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

export function canDo(role: RoleKey, capability: AdminCapability): boolean {
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability);
}
