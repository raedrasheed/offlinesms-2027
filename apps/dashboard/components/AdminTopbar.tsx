import { Bell } from 'lucide-react';
import AdminBreadcrumbs from './AdminBreadcrumbs';
import AdminUserMenu from './AdminUserMenu';
import AdminGlobalSearchShell from './AdminGlobalSearchShell';
import type { AdminRole } from '@/lib/session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';

type Props = {
  email?: string;
  role: RoleKey;
};

export default function AdminTopbar({ email, role }: Props) {
  return (
    <header className="bg-white border-b border-ink-100 px-7 py-3 flex items-center gap-4 sticky top-0 z-30">
      <div className="flex-1 min-w-0">
        <AdminBreadcrumbs />
      </div>
      <AdminGlobalSearchShell />
      <button
        aria-label="Notifications"
        className="w-9 h-9 rounded-lg bg-surface3 grid place-items-center text-ink-700 hover:bg-ink-50 transition shrink-0"
      >
        <Bell size={16} />
      </button>
      <AdminUserMenu email={email} role={role} />
    </header>
  );
}
