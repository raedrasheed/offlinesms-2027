// Calls dashboard — server component.
// callLogs collection read is soft-fail: missing collection shows EmptyState.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { adminDb } from '@/lib/firebase-admin';
import { safeDate } from '@/lib/redaction';
import { PermissionState, EmptyState } from '@/components/state';
import UserName from '@/components/admin/UserName';
import { resolveUserNames } from '@/lib/userNames';

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

  const names = await resolveUserNames(rows.map(r => r.initiatorUid));

  const CARD = 'var(--c-card)';
  const BORDER = 'var(--c-border)';

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div className="mb-6">
        <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-text-3)' }}>Admin / Calls</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">Calls</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--c-text-3)' }}>Voice and video call logs.</p>
      </div>

      {empty || rows.length === 0 ? (
        <div className="rounded-2xl p-12" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
          <EmptyState
            title="No call logs yet"
            description="Call log records will appear here once users make calls."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl" style={{ border: `1px solid ${BORDER}`, background: CARD }}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-[10px] font-bold tracking-wide uppercase" style={{ borderBottom: `1px solid ${BORDER}`, color: 'var(--c-text-4)' }}>
                <th className="px-4 py-3">Initiator</th>
                <th className="px-4 py-3">Conversation</th>
                <th className="px-4 py-3 text-right">Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Started</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="transition hover:bg-white/[0.03]" style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}>
                  <td className="px-4 py-3"><UserName uid={r.initiatorUid} info={r.initiatorUid ? names[r.initiatorUid] : null} /></td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--c-text-3)' }}>{r.conversationId?.slice(0, 10) ?? '—'}…</td>
                  <td className="px-4 py-3 text-right text-xs font-mono" style={{ color: 'var(--c-text)' }}>{r.durationSeconds}s</td>
                  <td className="px-4 py-3 text-xs capitalize" style={{ color: 'var(--c-text-2)' }}>{r.status}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--c-text-3)' }}>{r.startedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
