// Calls dashboard — server component.
// callLogs collection read is soft-fail: missing collection shows EmptyState.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { adminDb } from '@/lib/firebase-admin';
import { safeDate } from '@/lib/redaction';
import { PermissionState, EmptyState } from '@/components/state';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type CallLogRow = {
  id: string;
  initiatorUid: string | null;
  conversationId: string | null;
  durationSeconds: number;
  status: string;
  startedAt: string;
};

async function fetchCallLogs(): Promise<{ rows: CallLogRow[]; empty: boolean }> {
  try {
    const snap = await adminDb
      .collection('callLogs')
      .orderBy('startedAt', 'desc')
      .limit(50)
      .get();
    return {
      rows: snap.docs.map(d => {
        const data = d.data();
        return {
          id:              d.id,
          initiatorUid:    (data.initiatorUid    as string | null) ?? null,
          conversationId:  (data.conversationId  as string | null) ?? null,
          durationSeconds: (data.durationSeconds as number) ?? 0,
          status:          (data.status          as string) ?? 'unknown',
          startedAt:       safeDate(data.startedAt),
        };
      }),
      empty: snap.empty,
    };
  } catch {
    return { rows: [], empty: true };
  }
}

export default async function CallsPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/calls');
  if (!canDo(session.role, 'view:calls')) {
    return (
      <div className="p-8">
        <PermissionState title="Calls access required" description="Your role does not include access to call logs." />
      </div>
    );
  }

  const { rows, empty } = await fetchCallLogs();

  return (
    <div className="p-7">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900">Calls</h1>
        <p className="text-sm text-ink-500 mt-0.5">Voice and video call logs.</p>
      </div>

      {empty || rows.length === 0 ? (
        <div className="rounded-2xl border border-ink-100 bg-white p-12">
          <EmptyState
            title="No call logs yet"
            description="Call log records will appear here once users make calls."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface3 text-left text-[10px] font-bold text-ink-500 tracking-wide uppercase">
                <th className="px-4 py-3">Initiator</th>
                <th className="px-4 py-3">Conversation</th>
                <th className="px-4 py-3 text-right">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={`border-t border-ink-100 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'}`}>
                  <td className="px-4 py-3 font-mono text-xs text-ink-700">{r.initiatorUid?.slice(0, 12) ?? '—'}…</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-500">{r.conversationId?.slice(0, 10) ?? '—'}…</td>
                  <td className="px-4 py-3 text-right text-xs font-mono">{r.durationSeconds}s</td>
                  <td className="px-4 py-3 text-xs text-ink-600 capitalize">{r.status}</td>
                  <td className="px-4 py-3 text-xs text-ink-500 whitespace-nowrap">{r.startedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
