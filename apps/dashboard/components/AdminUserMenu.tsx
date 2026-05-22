'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { LogOut, ChevronDown } from 'lucide-react';
import { auth } from '@/lib/firebase';
import RoleBadge from './RoleBadge';
import type { AdminRole } from '@/lib/session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';

type Props = {
  email?: string;
  role: RoleKey;
};

export default function AdminUserMenu({ email, role }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function handleSignOut() {
    setOpen(false);
    try { await fetch('/api/session', { method: 'DELETE' }); } catch { /* ignore */ }
    try { await signOut(auth); } catch { /* ignore */ }
    router.push('/login');
  }

  const initials = email ? email.slice(0, 2).toUpperCase() : 'AD';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface3 transition"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <div className="w-7 h-7 rounded-full bg-primary text-white text-xs font-bold grid place-items-center select-none">
          {initials}
        </div>
        <ChevronDown size={12} className="text-ink-500" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white border border-ink-100 rounded-xl shadow-sh2 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100">
            <p className="text-xs font-semibold text-ink-900 truncate">{email ?? 'Admin'}</p>
            <div className="mt-1">
              <RoleBadge role={role} />
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-ink-700 hover:bg-surface3 transition"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
