import type { AdminRole } from '@/lib/session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';

const LABEL: Record<RoleKey, string> = {
  super_admin:       'Super Admin',
  organization_admin:'Org Admin',
  support_agent:     'Support',
  finance_admin:     'Finance',
  auditor:           'Auditor',
  legacy_admin:      'Admin',
  bootstrap_admin:   'Bootstrap',
};

const COLOR: Record<RoleKey, string> = {
  super_admin:        'bg-red-100 text-red-700',
  organization_admin: 'bg-blue-100 text-blue-700',
  support_agent:      'bg-green-100 text-green-700',
  finance_admin:      'bg-yellow-100 text-yellow-700',
  auditor:            'bg-purple-100 text-purple-700',
  legacy_admin:       'bg-gray-100 text-gray-700',
  bootstrap_admin:    'bg-orange-100 text-orange-700',
};

export default function RoleBadge({ role }: { role: RoleKey }) {
  return (
    <span className={`inline-block text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full ${COLOR[role] ?? 'bg-gray-100 text-gray-700'}`}>
      {LABEL[role] ?? role}
    </span>
  );
}
