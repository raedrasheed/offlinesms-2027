'use client';

import { useState } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { Building2, ChartNoAxesColumn, Code2, LayoutGrid, LogOut, Send, UsersRound } from 'lucide-react';
import { auth } from '@/lib/firebase';
import styles from './business.module.css';

const navigation = [
  { path: '/', label: 'Overview', icon: LayoutGrid },
  { path: '/groups', label: 'Recipient groups', icon: UsersRound },
  { path: '/send', label: 'Send message', icon: Send },
  { path: '/activity', label: 'Activity', icon: ChartNoAxesColumn },
  { path: '/integrations', label: 'API integration', icon: Code2 },
];

export function BusinessBrand() {
  return (
    <a href="/" className={styles.brand} aria-label="OfflineSMS Business home">
      <Image src="/logo.png" alt="" width={38} height={38} className={styles.logo} priority />
      <span className={styles.brandName}>OfflineSMS <span>Business</span></span>
    </a>
  );
}

export function BusinessShell({
  children, organizationName, email,
}: {
  children: React.ReactNode; organizationName: string; email?: string;
}) {
  const pathname = usePathname();
  const current = (pathname ?? '/').replace(/^\/business(?=\/|$)/, '') || '/';
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState(false);

  async function logout() {
    setLogoutPending(true);
    setLogoutError(false);
    try {
      const response = await fetch('/api/business/session', { method: 'DELETE' });
      if (!response.ok) throw new Error('logout_failed');
      await signOut(auth).catch(() => {});
      window.location.replace('/login');
    } catch {
      setLogoutError(true);
      setLogoutPending(false);
    }
  }

  return (
    <div className={styles.portal}>
      <header className={styles.header}>
        <div className={styles.headerContent}>
          <BusinessBrand />
          <div className={styles.account}>
            <span className={styles.orgIcon}><Building2 size={17} aria-hidden /></span>
            <div className={styles.accountName}>
              <strong>{organizationName}</strong>
              {email && <span>{email}</span>}
            </div>
            <button type="button" className={styles.logout} onClick={logout} disabled={logoutPending} aria-label="Sign out" title="Sign out">
              <LogOut size={17} aria-hidden />
              <span>{logoutPending ? 'Signing out…' : 'Sign out'}</span>
            </button>
          </div>
        </div>
        <nav className={styles.nav} aria-label="Business workspace">
          {navigation.map(({ path, label, icon: Icon }) => {
            const active = path === '/' ? current === path : current === path || current.startsWith(path + '/');
            return (
              <a key={path} href={path} aria-current={active ? 'page' : undefined}>
                <Icon size={16} aria-hidden />
                {label}
              </a>
            );
          })}
        </nav>
      </header>
      <main id="main-content" className={styles.main}>
        {logoutError && <p className={styles.error} role="alert">Could not sign out. Please try again.</p>}
        {children}
      </main>
    </div>
  );
}
