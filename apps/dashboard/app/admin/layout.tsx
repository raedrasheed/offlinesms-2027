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
      <div className="min-h-screen bg-bg-app grid place-items-center p-6">
        <div className="bg-bg-surface rounded-2xl shadow-sh2 p-8 w-full max-w-md">
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
    <div className="flex min-h-screen bg-canvas">
      <Sidebar role={role} />
      <div className="flex-1 min-w-0 flex flex-col">
        <AdminTopbar email={user.email} role={role} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
