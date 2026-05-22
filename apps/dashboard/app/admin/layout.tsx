// Server-rendered guard for `/admin/*`.
//
// Phase 1: enforces authentication + admin claim via Firebase session cookie.
// Phase 12: passes session user/role to client components (Sidebar, AdminTopbar).

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import AdminTopbar from '@/components/AdminTopbar';
import { PermissionState } from '@/components/state';
import { verifySession } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sessionCookie = cookies().get('__session')?.value;
  const session = await verifySession(sessionCookie);

  if (session.state === 'unauthenticated') {
    redirect('/login?next=/admin');
  }

  if (session.state === 'forbidden') {
    return (
      <div className="min-h-screen grid place-items-center p-6" style={{ background: '#0D1117' }}>
        <div className="rounded-2xl p-8 w-full max-w-md" style={{ background: '#131B27', border: '1px solid #1A2437' }}>
          <PermissionState
            title="Admin access required"
            description={
              session.user.email
                ? `Signed in as ${session.user.email}, but this account is not an admin. Ask an administrator to grant the role, then reload.`
                : "This account isn't an admin. Ask an administrator to grant the role, then reload."
            }
            primaryAction={{ label: 'Switch account', href: '/login' }}
          />
        </div>
      </div>
    );
  }

  const { user, role } = session;

  return (
    <div className="flex min-h-screen" style={{ background: '#0D1117' }}>
      <Sidebar role={role} />
      <div className="flex-1 min-w-0 flex flex-col">
        <AdminTopbar email={user.email} role={role} />
        <main id="main-content" className="flex-1">{children}</main>
      </div>
    </div>
  );
}
