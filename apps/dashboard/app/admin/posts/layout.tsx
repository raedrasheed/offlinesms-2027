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
export default async function PostsLayout({children}: {children: React.ReactNode}) {
  const session = await verifySession((await cookies()).get('__session')?.value);
  if (session.state !== 'authorized') redirect('/login?next=/admin/posts');
  if (!isPlatformAdmin(session) || !canDo(session.role, 'manage:clips') || !hasPlatformClipClaims(session.user.claims)) {
    return <div className="p-8"><PermissionState title="Platform administrator access required" /></div>;
  }
  return <div className="p-6 space-y-5" style={{color:'var(--c-text)'}}>
    <header className="flex items-center justify-between gap-4 flex-wrap"><div><h1 className="text-2xl font-extrabold">Posts</h1>
      <p className="text-sm mt-1" style={{color:'var(--c-text-3)'}}>Review text and image posts and handle reports.</p></div>
      <nav className="flex gap-4 text-sm"><Link href={'/admin/posts' as any}>Posts</Link><Link href={'/admin/posts?view=reports' as any}>Reports</Link><Link href={'/admin/clips/settings' as any}>Publishing settings</Link></nav>
    </header>{children}
  </div>;
}
