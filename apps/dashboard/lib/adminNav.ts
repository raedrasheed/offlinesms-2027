import {
  BarChart3, Users, Inbox, MessageCircle, Phone,
  Send, Coins, FileText, LifeBuoy, Shield, Settings, ScrollText, Building2, Globe, Flag,
  type LucideIcon,
} from 'lucide-react';
import type { AdminCapability } from './adminPermissions';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  capability: AdminCapability;
  exact?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/admin',               label: 'Overview',      icon: BarChart3,    capability: 'view:overview', exact: true },
  { href: '/admin/users',         label: 'Users',         icon: Users,        capability: 'view:users' },
  { href: '/admin/organizations', label: 'Organizations', icon: Building2,    capability: 'view:organizations' },
  { href: '/admin/groups',        label: 'Groups',        icon: MessageCircle, capability: 'view:groups' },
  { href: '/admin/communities',   label: 'Communities',   icon: Globe,        capability: 'view:communities' },
  { href: '/admin/calls',         label: 'Calls',         icon: Phone,        capability: 'view:calls' },
  { href: '/admin/chats',         label: 'Chats',         icon: Inbox,        capability: 'view:groups' },
  { href: '/admin/sms',           label: 'SMS Gateway',   icon: Send,         capability: 'view:sms' },
  { href: '/admin/points',        label: 'Points',        icon: Coins,        capability: 'view:points' },
  { href: '/admin/reports',       label: 'Reports',       icon: FileText,     capability: 'view:reports' },
  { href: '/admin/support',       label: 'Support',       icon: LifeBuoy,     capability: 'view:support' },
  { href: '/admin/roles',         label: 'Roles',         icon: Shield,       capability: 'view:roles' },
  { href: '/admin/settings',      label: 'Settings',      icon: Settings,     capability: 'view:settings' },
  { href: '/admin/audit',         label: 'Audit Log',     icon: ScrollText,   capability: 'view:audit' },
  { href: '/admin/moderation',   label: 'Moderation',    icon: Flag,         capability: 'view:moderation' },
];
