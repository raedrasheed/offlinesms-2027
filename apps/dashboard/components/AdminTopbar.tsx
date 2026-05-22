import { Bell } from 'lucide-react';
import AdminBreadcrumbs from './AdminBreadcrumbs';
import AdminUserMenu from './AdminUserMenu';
import AdminGlobalSearchShell from './AdminGlobalSearchShell';
import type { AdminRole } from '@/lib/session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';
type Props = { email?: string; role: RoleKey };

export default function AdminTopbar({ email, role }: Props) {
  return (
    <header
      className="px-6 py-3 flex items-center gap-4 sticky top-0 z-30 shrink-0"
      style={{ background: '#0D1117', borderBottom: '1px solid #1A2437' }}
    >
      <div className="flex-1 min-w-0">
        <AdminBreadcrumbs />
      </div>
      <AdminGlobalSearchShell />
      <button
        aria-label="Notifications"
        className="w-9 h-9 rounded-lg grid place-items-center transition shrink-0 hover:opacity-80"
        style={{ background: '#131B27', color: '#64748B', border: '1px solid #1A2437' }}
      >
        <Bell size={15} />
      </button>
      <div
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold shrink-0"
        style={{ background: '#0A2035', color: '#5BB6DE', border: '1px solid #0E3A5A' }}
      >
        <div
          className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold"
          style={{ background: '#0E4F6E' }}
        >
          A
        </div>
        Acme Co workspace
      </div>
      <AdminUserMenu email={email} role={role} />
    </header>
  );
}
