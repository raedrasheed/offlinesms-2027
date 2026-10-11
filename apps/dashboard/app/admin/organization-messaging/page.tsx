// Organization Messaging — usage summary, API key status, send form, logs.
//
// Scoping:
//   • organization_admin → locked to their own organization (claims), any
//     ?org= query param is ignored.
//   • super_admin (unrestricted scope) → picks an organization via ?org=,
//     with a picker list when none is selected.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope, isPlatformAdmin as isPlatformRole } from '@/lib/adminScope';
import { listOrganizations } from '@/lib/adminData';
import {
  getOrgMessagingOverview, getOrgApiKeyStatus, listOrgMessageBatches,
} from '@/lib/orgMessagingData';
import { sendOrganizationMessage, generateOrgApiKey, revokeOrgApiKey, updateOrgEscalationSettings } from '@/lib/orgMessagingActions';
import { PermissionState, EmptyState } from '@/components/state';
import SendMessageForm from './SendMessageForm';
import ApiKeySection from './ApiKeySection';
import EscalationSettings from './EscalationSettings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

function fmt(iso: string): string {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '—';
}

export default async function OrgMessagingPage({
  searchParams,
}: {
  searchParams?: { org?: string };
}) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/organization-messaging');
  if (!canDo(session.role, 'view:organization_messaging')) {
    return <div className="p-8"><PermissionState title="Organization messaging access required" /></div>;
  }

  const scope = getAdminScope(session);
  const isPlatformAdmin = isPlatformRole(session);
  // org_admin: always their own org. Platform admin: ?org= selection.
  const orgId = scope.organizationId ?? searchParams?.org ?? null;

  // Platform admin without a selection → organization picker.
  if (!orgId) {
    const orgs = await listOrganizations().catch(() => []);
    return (
      <div className="p-6 max-w-3xl space-y-5" style={{ color: 'var(--c-text)' }}>
        <Header isPlatformAdmin={isPlatformAdmin} />
        <div className="rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <h2 className="text-sm font-extrabold mb-3">Choose an organization</h2>
          {orgs.length === 0 ? (
            <EmptyState title="No organizations yet" description="Create an organization account to get started." />
          ) : (
            <ul className="space-y-1">
              {orgs.map(o => (
                <li key={o.id}>
                  <Link
                    href={`/admin/organization-messaging?org=${o.id}` as any}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm transition hover:bg-white/[0.04]"
                    style={{ border: `1px solid ${BORDER}` }}
                  >
                    <span className="font-semibold">{o.name}</span>
                    <span className="text-[11px] capitalize" style={{ color: 'var(--c-text-3)' }}>{o.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const overview = await getOrgMessagingOverview(orgId);
  if (!overview) {
    return <div className="p-8"><PermissionState title="Organization not found" /></div>;
  }
  const [apiKey, batches] = await Promise.all([
    getOrgApiKeyStatus(orgId),
    listOrgMessageBatches(orgId),
  ]);

  const sendAction = sendOrganizationMessage.bind(null, orgId);
  const pct = overview.percentUsed;

  return (
    <div className="p-6 max-w-4xl space-y-5" style={{ color: 'var(--c-text)' }}>
      <Header isPlatformAdmin={isPlatformAdmin} orgName={overview.name} />

      {/* 1 — Usage summary */}
      <section className="rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-extrabold tracking-tight">Usage — {overview.monthKey}</h2>
          <span
            className="px-2.5 py-1 rounded-full text-[11px] font-bold capitalize"
            style={overview.status === 'active'
              ? { background: 'rgba(34,197,94,0.12)', color: '#22C55E' }
              : { background: 'rgba(239,68,68,0.12)', color: '#EF4444' }}
          >
            {overview.status}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-4">
          <Stat label="Monthly limit" value={overview.monthlyMessageLimit.toLocaleString()} />
          <Stat label="Used this month" value={overview.usedThisMonth.toLocaleString()} />
          <Stat label="Remaining" value={overview.remainingThisMonth.toLocaleString()} />
          <Stat label="Used %" value={`${pct}%`} />
        </div>
        <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ background: 'var(--c-bg)' }}>
          <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: pct >= 100 ? '#EF4444' : '#1F7BA8' }} />
        </div>
        <p className="text-[11px] mt-2" style={{ color: 'var(--c-text-3)' }}>
          Only accepted (queued) messages count against the quota — failed and unsupported recipients don’t.
        </p>
      </section>

      {/* 1b — SMS escalation settings */}
      <section className="rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-extrabold tracking-tight">SMS escalation</h2>
          <span className="text-[11px]" style={{ color: 'var(--c-text-3)' }}>
            SMS wallet: <span className="font-bold" style={{ color: 'var(--c-text)' }}>
              {overview.smsWalletBalance == null ? '—' : `${overview.smsWalletBalance.toLocaleString()} pts`}
            </span>
          </span>
        </div>
        <EscalationSettings
          initial={overview.escalation}
          action={updateOrgEscalationSettings.bind(null, orgId)}
        />
      </section>

      {/* 2 — API key */}
      <section className="rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <h2 className="text-sm font-extrabold tracking-tight mb-3">API key</h2>
        <ApiKeySection
          status={apiKey}
          generateAction={generateOrgApiKey.bind(null, orgId)}
          revokeAction={revokeOrgApiKey.bind(null, orgId)}
        />
      </section>

      {/* 3 — Send message */}
      <section className="rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <h2 className="text-sm font-extrabold tracking-tight mb-1">Send message</h2>
        <p className="text-[12px] mb-4" style={{ color: 'var(--c-text-3)' }}>
          Delivered as real in-app messages to registered users; delivered/read come from the app’s receipts.
          {overview.escalation.enabled
            ? ` After ${overview.escalation.delayMinutes} min, ${escalationAudienceLabel(overview.escalation.audience)} are escalated to SMS.`
            : ' Auto SMS escalation is currently off.'}
        </p>
        <SendMessageForm action={sendAction} />
      </section>

      {/* 4 — Message logs */}
      <section className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <h2 className="text-sm font-extrabold tracking-tight px-6 pt-6 pb-3">Recent batches</h2>
        {batches.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState title="No messages yet" description="Batches sent from the dashboard or the API will appear here." />
          </div>
        ) : (
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr style={{ borderTop: `1px solid ${BORDER}`, borderBottom: `1px solid ${BORDER}` }}>
                {['Batch', 'Source', 'Status', 'Total', 'Delivered', 'Read', 'Failed', 'Unsupported', 'Escalation', 'Created'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr key={b.id} className="transition hover:bg-white/[0.03]" style={i < batches.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/organization-messaging/batches/${b.id}` as any}
                      className="font-mono text-[11px] hover:underline"
                      style={{ color: '#5BB6DE' }}
                    >
                      {b.id.slice(0, 12)}…
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 capitalize">{b.source}</td>
                  <td className="px-4 py-2.5 capitalize">{b.status}</td>
                  <td className="px-4 py-2.5">{b.total}</td>
                  <td className="px-4 py-2.5">{b.delivered}</td>
                  <td className="px-4 py-2.5">{b.read}</td>
                  <td className="px-4 py-2.5">{b.failed}</td>
                  <td className="px-4 py-2.5">{b.unsupported}</td>
                  <td className="px-4 py-2.5 capitalize" style={{ color: 'var(--c-text-3)' }}>{b.escalationStatus.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: 'var(--c-text-4)' }}>{fmt(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function escalationAudienceLabel(a: string): string {
  if (a === 'unread_only') return 'unread users';
  if (a === 'undelivered_only') return 'undelivered users';
  return 'all users';
}

function Header({ isPlatformAdmin, orgName }: { isPlatformAdmin: boolean; orgName?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-text-3)' }}>Admin / Organization messaging</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">
          Organization Messaging{orgName ? ` — ${orgName}` : ''}
        </h1>
      </div>
      {isPlatformAdmin && (
        <div className="flex items-center gap-2">
          {orgName ? (
            <Link
              href={'/admin/organization-messaging' as any}
              className="px-3 py-2 text-sm font-bold rounded-lg"
              style={{ border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}
            >
              Switch organization
            </Link>
          ) : null}
          <Link
            href={'/admin/organization-messaging/new' as any}
            className="px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110"
            style={{ background: '#1F7BA8', color: '#fff' }}
          >
            New organization account
          </Link>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--c-text-4)' }}>{label}</p>
      <p className="text-lg font-extrabold mt-0.5 capitalize">{value}</p>
    </div>
  );
}
