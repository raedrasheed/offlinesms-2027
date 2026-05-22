import type { AdminRole } from './session';

export type AdminCapability =
  | 'view:overview'
  | 'view:users'
  | 'manage:users'
  | 'view:organizations'
  | 'manage:organizations'
  | 'view:groups'
  | 'manage:groups'
  | 'view:calls'
  | 'view:sms'
  | 'manage:sms'
  | 'view:points'
  | 'view:reports'
  | 'view:support'
  | 'view:roles'
  | 'manage:roles'
  | 'view:settings'
  | 'view:audit'
  | 'view:communities'
  // Phase 15
  | 'manage:wallets'
  | 'manage:packages'
  | 'retry:sms'
  | 'manage:support'
  | 'manage:settings'
  // Phase 16
  | 'export:audit'
  | 'view:moderation';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';

const ROLE_CAPABILITIES: Record<RoleKey, readonly AdminCapability[]> = {
  super_admin: [
    'view:overview', 'view:users', 'manage:users',
    'view:organizations', 'manage:organizations',
    'view:groups', 'manage:groups',
    'view:calls', 'view:sms', 'manage:sms',
    'view:points', 'view:reports', 'view:support',
    'view:roles', 'manage:roles',
    'view:settings', 'view:audit', 'view:communities',
    'manage:wallets', 'manage:packages', 'retry:sms', 'manage:support', 'manage:settings',
    'export:audit', 'view:moderation',
  ],
  organization_admin: [
    'view:overview', 'view:users',
    'view:organizations', 'manage:organizations',
    'view:groups', 'manage:groups',
    'view:calls', 'view:sms', 'view:reports', 'view:support',
    'view:settings', 'view:communities',
    'retry:sms',
  ],
  support_agent: [
    'view:overview', 'view:users', 'view:support',
    'view:sms',
    'manage:support', 'view:moderation',
  ],
  finance_admin: [
    'view:overview', 'view:points', 'view:reports',
    'view:sms',
    'manage:wallets', 'manage:packages',
  ],
  auditor: [
    'view:overview', 'view:reports', 'view:audit',
    'view:sms', 'view:points',
    'export:audit', 'view:moderation',
  ],
  legacy_admin: [
    'view:overview', 'view:users', 'manage:users',
    'view:organizations', 'manage:organizations',
    'view:groups', 'manage:groups',
    'view:calls', 'view:sms', 'manage:sms',
    'view:points', 'view:reports', 'view:support',
    'view:roles', 'manage:roles',
    'view:settings', 'view:audit', 'view:communities',
    'manage:wallets', 'manage:packages', 'retry:sms', 'manage:support', 'manage:settings',
    'export:audit', 'view:moderation',
  ],
  bootstrap_admin: [
    'view:overview', 'view:users', 'manage:users',
    'view:organizations', 'manage:organizations',
    'view:groups', 'manage:groups',
    'view:calls', 'view:sms', 'manage:sms',
    'view:points', 'view:reports', 'view:support',
    'view:roles', 'manage:roles',
    'view:settings', 'view:audit', 'view:communities',
    'manage:wallets', 'manage:packages', 'retry:sms', 'manage:support', 'manage:settings',
    'export:audit', 'view:moderation',
  ],
};

export function getCapabilities(role: RoleKey): readonly AdminCapability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

export function canDo(role: RoleKey, capability: AdminCapability): boolean {
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability);
}
