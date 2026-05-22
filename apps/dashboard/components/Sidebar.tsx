'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import {
  LogOut, ChevronDown, Search, LayoutGrid, LineChart,
  Users, Building2, MessageCircle, Globe,
  Inbox, Phone, Send,
  Coins, ArrowLeftRight,
  LifeBuoy, Flag, Radio,
  Shield, ScrollText, Bell, Settings,
  type LucideIcon,
} from 'lucide-react';
import { auth } from '@/lib/firebase';
import { canDo } from '@/lib/adminPermissions';
import clsx from 'clsx';
import type { AdminRole } from '@/lib/session';

type RoleKey = AdminRole | 'legacy_admin' | 'bootstrap_admin';
type Props = { role: RoleKey };

type NavItemDef = {
  href: string;
  label: string;
  icon: LucideIcon;
  capability: string;
  exact?: boolean;
  badge?: string;
};

type NavGroup = { label: string; items: NavItemDef[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard', icon: LayoutGrid, capability: 'view:overview', exact: true },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { href: '/admin/reports', label: 'Analytics', icon: LineChart, capability: 'view:reports' },
    ],
  },
  {
    label: 'People & Places',
    items: [
      { href: '/admin/users',         label: 'Users',         icon: Users,         capability: 'view:users' },
      { href: '/admin/organizations', label: 'Organizations', icon: Building2,     capability: 'view:organizations' },
      { href: '/admin/groups',        label: 'Groups',        icon: MessageCircle, capability: 'view:groups' },
      { href: '/admin/communities',   label: 'Communities',   icon: Globe,         capability: 'view:communities' },
    ],
  },
  {
    label: 'Messaging',
    items: [
      { href: '/admin/chats', label: 'Conversations', icon: Inbox,  capability: 'view:groups' },
      { href: '/admin/calls', label: 'Messages',      icon: Phone,  capability: 'view:calls' },
      { href: '/admin/sms',   label: 'SMS escalation', icon: Send,  capability: 'view:sms', badge: 'NEW' },
    ],
  },
  {
    label: 'Wallet',
    items: [
      { href: '/admin/points',              label: 'OfflineSMSPoints', icon: Coins,          capability: 'view:points' },
      { href: '/admin/points/transactions', label: 'Transactions',     icon: ArrowLeftRight, capability: 'view:points' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/support',    label: 'Support',    icon: LifeBuoy, capability: 'view:support' },
      { href: '/admin/moderation', label: 'Moderation', icon: Flag,     capability: 'view:moderation' },
      { href: '/admin/sms',        label: 'Gateway',    icon: Radio,    capability: 'view:sms' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/roles',         label: 'Roles & perms', icon: Shield,     capability: 'view:roles' },
      { href: '/admin/audit',         label: 'Audit logs',    icon: ScrollText, capability: 'view:audit' },
      { href: '/admin/notifications', label: 'Notifications', icon: Bell,       capability: 'view:notifications' },
      { href: '/admin/settings',      label: 'Settings',      icon: Settings,   capability: 'view:settings' },
    ],
  },
];

export default function Sidebar({ role }: Props) {
  const path = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    try { await fetch('/api/session', { method: 'DELETE' }); } catch { /* ignore */ }
    try { await signOut(auth); } catch { /* ignore */ }
    router.push('/login');
  }

  return (
    <aside
      className="w-[240px] flex flex-col h-screen sticky top-0 overflow-y-auto shrink-0"
      style={{ background: 'var(--c-sidebar)', borderRight: '1px solid var(--c-border)' }}
    >
      <div className="flex items-center gap-2.5 px-4 py-4 shrink-0">
        <span className="brand-mark shrink-0" />
        <span className="font-extrabold text-[15px] tracking-tight" style={{ color: 'var(--c-text)' }}>
          Offline<span style={{ color: '#5BB6DE' }}>SMS</span>
        </span>
        <span
          className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
          style={{ background: 'var(--c-nav-active-bg)', color: 'var(--c-nav-active-text)' }}
        >
          ADMIN
        </span>
      </div>

      <div className="px-3 pb-2 shrink-0">
        <button
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition hover:bg-white/5"
          style={{ background: 'var(--c-sidebar-sub)' }}
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
            style={{ background: 'var(--c-nav-active-bg)', color: 'var(--c-nav-active-text)' }}
          >
            A
          </div>
          <span className="text-[12px] font-medium flex-1 truncate" style={{ color: 'var(--c-text-2)' }}>
            Acme Co workspace
          </span>
          <ChevronDown size={13} style={{ color: 'var(--c-text-4)' }} className="shrink-0" />
        </button>
      </div>

      <div className="px-3 pb-3 shrink-0">
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg"
          style={{ background: 'var(--c-sidebar-sub)', border: '1px solid var(--c-border)' }}
        >
          <Search size={12} style={{ color: 'var(--c-text-4)' }} className="shrink-0" />
          <span className="text-[12px]" style={{ color: 'var(--c-text-4)' }}>Search...</span>
        </div>
      </div>

      <nav className="flex-1 px-2 pb-3 space-y-3 overflow-y-auto">
        {NAV_GROUPS.map(group => {
          const visibleItems = group.items.filter(item =>
            canDo(role as any, item.capability as any)
          );
          if (!visibleItems.length) return null;
          return (
            <div key={group.label}>
              <p
                className="px-3 pb-1 text-[10px] font-bold uppercase tracking-widest"
                style={{ color: 'var(--c-nav-group)' }}
              >
                {group.label}
              </p>
              {visibleItems.map(item => {
                const isActive = item.exact
                  ? path === item.href
                  : path?.startsWith(item.href) ?? false;
                return (
                  <Link
                    key={item.href + item.label}
                    href={item.href as any}
                    className={clsx(
                      'flex items-center gap-2.5 px-3 py-[7px] rounded-lg text-[13px] font-medium transition mb-0.5',
                      !isActive && 'hover:bg-white/5'
                    )}
                    style={
                      isActive
                        ? { background: 'var(--c-nav-active-bg)', color: 'var(--c-nav-active-text)' }
                        : { color: 'var(--c-text-3)' }
                    }
                  >
                    <item.icon size={14} className="shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0"
                        style={{ background: 'var(--c-nav-active-bg)', color: 'var(--c-nav-active-text)' }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className="px-3 py-3 shrink-0" style={{ borderTop: '1px solid var(--c-border)' }}>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition hover:bg-white/5"
          style={{ color: 'var(--c-text-4)' }}
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
