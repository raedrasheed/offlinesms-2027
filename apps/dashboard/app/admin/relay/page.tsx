// Admin SMS Relay devices — server component. Lists OfflineSMS-Business relay
// devices for the caller's organization (super_admin sees all / filters by ?org).
// No message bodies or full phone numbers are ever shown.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope } from '@/lib/adminScope';
import { adminDb } from '@/lib/firebase-admin';
import { listOrganizations } from '@/lib/adminData';
import { ADMIN_LABELS } from '@/lib/i18n';
import { PermissionState } from '@/components/state';
import { effectiveRelayCaps } from '@/lib/otpLimits';
import RelayAdmin, { type RelayDeviceView, type RelayOrgStatus } from './RelayAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function ms(ts: any): number | null { return ts?.toMillis?.() ?? null; }

async function resolveMode(businessId: string | null): Promise<RelayOrgStatus> {
  try {
    const snap = await adminDb.collection('smsConfig').doc('providers').get();
    const data = (snap.exists ? snap.data() : {}) as { default?: string; byBusiness?: Record<string, string> };
    const raw = (businessId && data.byBusiness?.[businessId]) || data.default || 'http';
    const mode = raw === 'relay' ? 'relay' : raw === 'relay_with_http_fallback' ? 'hybrid' : 'http';
    return { mode, relayEnabled: mode !== 'http' };
  } catch {
    return { mode: 'http', relayEnabled: false };
  }
}

export default async function RelayAdminPage({ searchParams }: { searchParams?: { org?: string } }) {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/relay');
  if (!canDo(session.role, 'view:relay')) {
    return <div className="p-8"><PermissionState title="Relay access required" /></div>;
  }

  const scope = getAdminScope(session);
  const businessId = scope.organizationId ?? (searchParams?.org?.trim() || null);
  const canManage = canDo(session.role, 'manage:relay');

  // Unrestricted (super/legacy/bootstrap) admins pick the org; org-scoped admins
  // are already bound to their own organization.
  const isUnrestricted = scope.organizationId === undefined;
  let orgOptions: { id: string; name: string }[] = [];
  if (isUnrestricted) {
    try { orgOptions = (await listOrganizations()).map(o => ({ id: o.id ?? '', name: o.name })); }
    catch { /* org list is best-effort */ }
  }

  let q = adminDb.collection('relayDevices').limit(100) as FirebaseFirestore.Query;
  if (businessId) q = adminDb.collection('relayDevices').where('businessId', '==', businessId).limit(100);

  let devices: RelayDeviceView[] = [];
  let fetchError: string | null = null;
  try {
    const snap = await q.get();
    devices = snap.docs
      .map(d => {
        const x = d.data();
        return {
          deviceId: d.id,
          businessId: (x.businessId as string) ?? '',
          label: (x.label as string) ?? 'Relay device',
          status: (x.status as string) ?? 'offline',
          lastHeartbeatAt: ms(x.lastHeartbeatAt),
          appVersion: (x.appVersion as string) ?? null,
          manufacturer: (x.manufacturer as string) ?? null,
          model: (x.model as string) ?? null,
          simInfo: Array.isArray(x.simInfo) ? (x.simInfo as any[]).map(s => ({
            carrierName: s?.carrierName ?? null, slotIndex: s?.slotIndex ?? null,
          })) : [],
          sentToday: (x.counters?.sentToday as number) ?? 0,
          failedToday: (x.counters?.failedToday as number) ?? 0,
          deliveredToday: (x.counters?.deliveredToday as number) ?? 0,
          lastError: (x.lastError as string) ?? null,
          allowedCountryCodes: Array.isArray(x.allowedCountryCodes) ? (x.allowedCountryCodes as string[]) : [],
          countryRoutingEnabled: x.countryRoutingEnabled === true,
          caps: effectiveRelayCaps(x.caps),
        };
      })
      .sort((a, b) => (b.lastHeartbeatAt ?? 0) - (a.lastHeartbeatAt ?? 0));
  } catch (e: any) {
    fetchError = e?.message ?? 'Failed to load relay devices.';
  }

  const orgStatus = await resolveMode(businessId);

  const now = Date.now();
  const healthyDevices = devices.filter(
    d => d.status === 'active' && d.lastHeartbeatAt != null && now - d.lastHeartbeatAt < 90_000,
  ).length;

  // Country coverage view: for each country a configured relay serves, how many
  // are currently active (online) vs offline. "Available" iff ≥1 active relay.
  const coverageMap = new Map<string, { active: number; offline: number }>();
  for (const d of devices) {
    if (d.status === 'revoked' || !d.countryRoutingEnabled || d.allowedCountryCodes.length === 0) continue;
    const online = d.status === 'active' && d.lastHeartbeatAt != null && now - d.lastHeartbeatAt < 90_000;
    for (const cc of d.allowedCountryCodes) {
      const e = coverageMap.get(cc) ?? { active: 0, offline: 0 };
      if (online) e.active++; else e.offline++;
      coverageMap.set(cc, e);
    }
  }
  const coverage = [...coverageMap.entries()]
    .map(([country, c]) => ({ country, active: c.active, offline: c.offline, available: c.active > 0 }))
    .sort((a, b) => a.country.localeCompare(b.country));

  // Relay queue health for this organization (counts by status).
  const STATUSES = ['queued', 'claimed', 'sending', 'sent', 'delivered', 'failed', 'expired'] as const;
  const queueHealth: Record<string, number> = {};
  if (businessId) {
    await Promise.all(STATUSES.map(async s => {
      try {
        const c = await adminDb.collection('relayJobs')
          .where('businessId', '==', businessId).where('status', '==', s).count().get();
        queueHealth[s] = c.data().count;
      } catch { queueHealth[s] = 0; }
    }));
  }

  return (
    <div className="p-6 space-y-5" style={{ color: 'var(--c-text)' }}>
      <div>
        <h1 className="text-xl font-semibold">{ADMIN_LABELS.relay.title}</h1>
        <p className="text-sm" style={{ color: 'var(--c-text-muted)' }}>{ADMIN_LABELS.relay.subtitle}</p>
      </div>
      <RelayAdmin
        devices={devices}
        orgStatus={orgStatus}
        businessId={businessId}
        canManage={canManage}
        isPlatform={isUnrestricted}
        fetchError={fetchError}
        queueHealth={queueHealth}
        healthyDevices={healthyDevices}
        orgOptions={orgOptions}
        coverage={coverage}
      />
    </div>
  );
}
