import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { isPlatformAdmin } from '@/lib/adminScope';
import { canDo } from '@/lib/adminPermissions';
import { hasPlatformClipClaims } from '@/lib/clipAdminPolicy';
import { PermissionState } from '@/components/state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function ClipsLayout({ children }: { children: React.ReactNode }) {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized') redirect('/login?next=/admin/clips');
  if (!isPlatformAdmin(session) || !canDo(session.role, 'view:clips')
      || (session.role !== 'super_admin' && !hasPlatformClipClaims(session.user.claims))) return <div className="p-8"><PermissionState title="Platform administrator access required" /></div>;
  return <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Admin / Clips</p><h1 className="text-2xl font-extrabold mt-1">Clips</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>Review videos, handle reports and manage publishing.</p></div>
      <nav aria-label="Clips administration" className="flex gap-2 text-sm font-semibold">
        <Link href={'/admin/clips' as any} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--c-border)' }}>Videos</Link>
        <Link href={'/admin/clips/reports' as any} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--c-border)' }}>Reports</Link>
        <Link href={'/admin/clips/settings' as any} className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--c-border)' }}>Settings</Link>
      </nav>
    </header>
    {children}
  </div>;
}
