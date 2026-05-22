'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { LogOut, ChevronDown } from 'lucide-react';
import { auth } from '@/lib/firebase';
import type { AdminRole } from '@/lib/session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';
type Props = { email?: string; role: RoleKey };

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  organization_admin: 'Org Admin',
  support_agent: 'Support Agent',
  finance_admin: 'Finance Admin',
  auditor: 'Auditor',
  legacy_admin: 'Admin',
  bootstrap_admin: 'Bootstrap Admin',
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
  const name = email ? email.split('@')[0].replace(/[._]/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'Admin';

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-white/5"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <div
          className="w-7 h-7 rounded-full text-white text-[11px] font-bold grid place-items-center select-none shrink-0"
          style={{ background: '#1F7BA8' }}
        >
          {initials}
        </div>
        <div className="text-left hidden sm:block">
          <p className="text-[12px] font-semibold leading-tight" style={{ color: '#E2E8F2' }}>{name}</p>
          <p className="text-[10px] leading-tight" style={{ color: '#64748B' }}>{ROLE_LABELS[role] ?? role}</p>
        </div>
        <ChevronDown size={12} style={{ color: '#475569' }} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-56 rounded-xl z-50 overflow-hidden"
          style={{ background: '#131B27', border: '1px solid #1A2437', boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}
        >
          <div className="px-4 py-3" style={{ borderBottom: '1px solid #1A2437' }}>
            <p className="text-[12px] font-semibold truncate" style={{ color: '#E2E8F2' }}>{email ?? 'Admin'}</p>
            <p className="text-[11px] mt-0.5" style={{ color: '#64748B' }}>{ROLE_LABELS[role] ?? role}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-[13px] transition hover:bg-white/5"
            style={{ color: '#94A3B8' }}
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
