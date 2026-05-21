// Server-rendered guard for `/admin/*`.
//
// Phase 1: this layout enforces authentication + an admin claim **server-side**
// using the Firebase session cookie set by `/api/session`. It is intentionally
// dynamic (no static prerender) so each request goes through `verifySession`.
//
// Behaviour:
//   - No session cookie → redirect to /login (preserves `next`).
//   - Cookie verifies but user has no admin role → render PermissionState
//     (no redirect loop; the user is signed in, just unauthorised).
//   - Authorised → render the admin shell as before.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
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
                ? `Signed in as ${session.user.email}, but this account isn’t an admin. Ask an administrator to grant the role, then reload.`
                : 'This account isn’t an admin. Ask an administrator to grant the role, then reload.'
            }
            primaryAction={{ label: 'Switch account', href: '/login' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
