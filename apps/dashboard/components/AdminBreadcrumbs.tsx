'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight } from 'lucide-react';

const SEGMENT_LABEL: Record<string, string> = {
  admin:    'Admin',
  users:    'Users',
  chats:    'Chats',
  groups:   'Groups',
  calls:    'Calls',
  sms:      'SMS Gateway',
  points:   'Points',
  reports:  'Reports',
  support:  'Support',
  roles:    'Roles',
  settings: 'Settings',
  audit:    'Audit Log',
};

export default function AdminBreadcrumbs() {
  const path = usePathname() ?? '/admin';
  const parts = path.split('/').filter(Boolean);

  const crumbs: { label: string; href: string }[] = [];
  let built = '';
  for (const part of parts) {
    built += `/${part}`;
    crumbs.push({ label: SEGMENT_LABEL[part] ?? part, href: built });
  }

  if (crumbs.length <= 1) return null;

  return (
    <nav aria-label="breadcrumb" className="flex items-center gap-1 text-xs text-ink-500">
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          {i > 0 && <ChevronRight size={12} className="text-ink-300" />}
          {i < crumbs.length - 1 ? (
            <Link href={c.href as any} className="hover:text-ink-900 transition">{c.label}</Link>
          ) : (
            <span className="font-semibold text-ink-700">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
