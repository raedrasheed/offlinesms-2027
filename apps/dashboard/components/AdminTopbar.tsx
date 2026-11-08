import { Bell } from 'lucide-react';
import Link from 'next/link';
import { canDo } from '@/lib/adminPermissions';
import AdminBreadcrumbs from './AdminBreadcrumbs';
import AdminUserMenu from './AdminUserMenu';
import AdminGlobalSearchShell from './AdminGlobalSearchShell';
import ThemeToggle from './ThemeToggle';
import type { AdminRole } from '@/lib/session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';
type Props = { email?: string; role: RoleKey; workspace: string };

export default function AdminTopbar({ email, role, workspace }: Props) {
  return (
    <header
      className="px-6 py-3 flex items-center gap-4 sticky top-0 z-30 shrink-0"
      style={{ background: 'var(--c-bg)', borderBottom: '1px solid var(--c-border)' }}
    >
      <div className="flex-1 min-w-0">
        <AdminBreadcrumbs />
      </div>
      <div className="hidden xl:block"><AdminGlobalSearchShell /></div>
      <ThemeToggle />
      {canDo(role, 'view:broadcast_notifications') && <Link href="/admin/notifications"
        aria-label="Notifications"
        className="w-9 h-9 rounded-lg grid place-items-center transition shrink-0 hover:opacity-80"
        style={{ background: 'var(--c-card)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}
      >
        <Bell size={15} />
      </Link>}
      <div
        className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold shrink-0 max-w-48 truncate"
        style={{ background: '#0A2035', color: '#5BB6DE', border: '1px solid #0E3A5A' }}
      >
        <div
          className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold"
          style={{ background: '#0E4F6E' }}
        >
          {workspace.charAt(0).toUpperCase()}
        </div>
        <span className="truncate" title={workspace}>{workspace}</span>
      </div>
      <AdminUserMenu email={email} role={role} />
    </header>
  );
}

