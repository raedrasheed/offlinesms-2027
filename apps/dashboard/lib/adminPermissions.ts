import type { AdminRole } from './session';

export type AdminCapability =
  | 'view:overview'
  | 'view:users'
  | 'view:groups'
  | 'view:calls'
  | 'view:sms'
  | 'view:points'
  | 'view:reports'
  | 'view:support'
  | 'view:roles'
  | 'view:settings'
  | 'view:audit';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';

const ROLE_CAPABILITIES: Record<RoleKey, readonly AdminCapability[]> = {
  super_admin: [
    'view:overview', 'view:users', 'view:groups', 'view:calls',
    'view:sms', 'view:points', 'view:reports', 'view:support',
    'view:roles', 'view:settings', 'view:audit',
  ],
  organization_admin: [
    'view:overview', 'view:users', 'view:groups', 'view:calls',
    'view:reports', 'view:support', 'view:settings',
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
    'view:overview', 'view:users', 'view:groups', 'view:calls',
    'view:sms', 'view:points', 'view:reports', 'view:support',
    'view:roles', 'view:settings', 'view:audit',
  ],
  bootstrap_admin: [
    'view:overview', 'view:users', 'view:groups', 'view:calls',
    'view:sms', 'view:points', 'view:reports', 'view:support',
    'view:roles', 'view:settings', 'view:audit',
  ],
};

export function getCapabilities(role: RoleKey): readonly AdminCapability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

export function canDo(role: RoleKey, capability: AdminCapability): boolean {
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability);
}
