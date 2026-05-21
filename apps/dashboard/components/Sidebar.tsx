'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import {
  MessageCircle, Users, Inbox, Phone, Coins, Send,
  BarChart3, Shield, LifeBuoy, Settings, LogOut,
} from 'lucide-react';
import clsx from 'clsx';

const nav = [
  { href: '/admin',           label: 'Overview',      icon: BarChart3 },
  { href: '/admin/users',     label: 'Users',         icon: Users },
  { href: '/admin/chats',     label: 'Chats',         icon: Inbox },
  { href: '/admin/groups',    label: 'Groups',        icon: MessageCircle },
  { href: '/admin/calls',     label: 'Calls',         icon: Phone },
  { href: '/admin/sms',       label: 'SMS Gateway',   icon: Send },
  { href: '/admin/points',    label: 'Points',        icon: Coins },
  { href: '/admin/reports',   label: 'Reports',       icon: BarChart3 },
  { href: '/admin/support',   label: 'Support',       icon: LifeBuoy },
  { href: '/admin/roles',     label: 'Roles',         icon: Shield },
  { href: '/admin/settings',  label: 'Settings',      icon: Settings },
];

export default function Sidebar() {
  const path = usePathname();
  const router = useRouter();
  async function handleSignOut() {
    try { await fetch('/api/session', { method: 'DELETE' }); } catch { /* ignore */ }
    try { await signOut(auth); } catch { /* ignore */ }
    router.push('/login');
  }
  return (
    <aside className="w-60 bg-ink text-white flex flex-col p-4 gap-1 h-screen sticky top-0">
      <div className="flex items-center gap-3 px-2 py-3 mb-2">
        <span className="brand-mark" />
        <span className="font-extrabold text-lg tracking-tight">
          Offline<span className="text-[#5BB6DE]">SMS</span>
        </span>
      </div>
      {nav.map(n => {
        const active = path === n.href || (n.href !== '/admin' && path?.startsWith(n.href));
        return (
          <Link key={n.href} href={n.href as any}
            className={clsx(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition',
              active ? 'bg-primary text-white' : 'text-white/70 hover:bg-white/5'
            )}>
            <n.icon size={16}/> {n.label}
          </Link>
        );
      })}
      <button onClick={handleSignOut} className="mt-auto flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/5">
        <LogOut size={16}/> Sign out
      </button>
    </aside>
  );
}
