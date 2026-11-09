import { PermissionState } from '@/components/state';
import { requireStatusesAdmin } from '@/lib/clipAdminAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function StatusesLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireStatusesAdmin();
  } catch {
    return <div className="p-8"><PermissionState title="Platform administrator access required" /></div>;
  }
  return <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
    <header>
      <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>Admin / Statuses</p>
      <h1 className="text-2xl font-extrabold mt-1">Statuses</h1>
      <p className="text-sm mt-1" style={{ color: 'var(--c-text-3)' }}>Review text, photo and video statuses and manage their visibility.</p>
    </header>
    {children}
  </div>;
}
