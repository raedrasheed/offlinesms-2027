'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { LogOut } from 'lucide-react';
import { auth } from '@/lib/firebase';
import { NAV_ITEMS } from '@/lib/adminNav';
import { canDo } from '@/lib/adminPermissions';
import RoleBadge from './RoleBadge';
import clsx from 'clsx';
import type { AdminRole } from '@/lib/session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';

type Props = { role: RoleKey };

export default function Sidebar({ role }: Props) {
  const path = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    try { await fetch('/api/session', { method: 'DELETE' }); } catch { /* ignore */ }
    try { await signOut(auth); } catch { /* ignore */ }
    router.push('/login');
  }

  const visibleItems = NAV_ITEMS.filter(item => canDo(role, item.capability));

  return (
    <aside className="w-60 bg-ink text-white flex flex-col p-4 gap-1 h-screen sticky top-0">
      <div className="flex items-center gap-3 px-2 py-3 mb-2">
        <span className="brand-mark" />
        <span className="font-extrabold text-lg tracking-tight">
          Offline<span className="text-[#5BB6DE]">SMS</span>
        </span>
      </div>

      {visibleItems.map(item => {
          const finalActive = item.exact
          ? path === item.href
          : path?.startsWith(item.href) ?? false;
        return (
          <Link
            key={item.href}
            href={item.href as any}
            className={clsx(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition',
              finalActive ? 'bg-primary text-white' : 'text-white/70 hover:bg-white/5'
            )}
          >
            <item.icon size={16} /> {item.label}
          </Link>
        );
      })}

      <div className="mt-auto flex flex-col gap-2 pt-3 border-t border-white/10">
        <div className="px-3">
          <RoleBadge role={role} />
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5"
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </aside>
  );
}
