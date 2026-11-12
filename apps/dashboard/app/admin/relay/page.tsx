// Admin SMS Relay devices — server component. Lists OfflineSMS-Business relay
// devices for the caller's organization (super_admin sees all / filters by ?org).
// No message bodies or full phone numbers are ever shown.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope, isPlatformAdmin } from '@/lib/adminScope';
import { adminDb } from '@/lib/firebase-admin';
import { ADMIN_LABELS } from '@/lib/i18n';
import { PermissionState } from '@/components/state';
import { effectiveRelayCaps } from '@/lib/otpLimits';
import RelayAdmin, { type RelayAssignmentOption, type RelayDeviceView, type RelayOrgStatus } from './RelayAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function ms(ts: any): number | null { return ts?.toMillis?.() ?? null; }

function countryCodes(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((code): code is string => typeof code === 'string') : [];
}

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

export default async function RelayAdminPage({ searchParams: searchParamsPromise }: { searchParams?: Promise<{ org?: string }> }) {
  const searchParams = await searchParamsPromise;
  const cookie = (await cookies()).get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/relay');
  if (!canDo(session.role, 'view:relay')) {
    return <div className="p-8"><PermissionState title="Relay access required" /></div>;
  }

  const scope = getAdminScope(session);
  const requestedOrg = typeof searchParams?.org === 'string' ? searchParams.org.trim() : '';
  const businessId = scope.organizationId ?? (requestedOrg || null);
  const canManage = canDo(session.role, 'manage:relay');
  const isPlatform = isPlatformAdmin(session);

  // Unrestricted (super/legacy/bootstrap) admins pick the org; org-scoped admins
  // are already bound to their own organization.
  const isUnrestricted = scope.organizationId === undefined;
  let orgOptions: { id: string; name: string }[] = [];
  if (isUnrestricted) {
    try {
      const orgs = await adminDb.collection('organizations').select('name').get();
      orgOptions = orgs.docs.map(org => ({
        id: org.id, name: typeof org.get('name') === 'string' ? org.get('name') : org.id,
      })).sort((a, b) => a.name.localeCompare(b.name));
    }
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
          allowedCountryCodes: countryCodes(x.allowedCountryCodes),
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
  let assignedDeviceId: string | null = null;
  let assignmentOptions: RelayAssignmentOption[] = [];
  let assignmentError: string | null = null;
  let coverageDevices: Pick<RelayDeviceView, 'status' | 'lastHeartbeatAt' | 'allowedCountryCodes' | 'countryRoutingEnabled'>[] = devices;
  if (businessId) {
    try {
      const assignment = await adminDb.collection('organizationRelayAssignments').doc(businessId).get();
      if (assignment.exists) {
        const id = assignment.get('relayDeviceId');
        if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid relay assignment.');
        assignedDeviceId = id;
        const relay = await adminDb.collection('relayDevices').doc(id).get();
        coverageDevices = relay.exists ? [{
          status: relay.get('status') ?? 'offline',
          lastHeartbeatAt: ms(relay.get('lastHeartbeatAt')),
          countryRoutingEnabled: relay.get('countryRoutingEnabled') === true,
          allowedCountryCodes: countryCodes(relay.get('allowedCountryCodes')),
        }] : [];
      }
    } catch {
      coverageDevices = [];
      assignmentError = 'Could not load the organization relay assignment.';
    }
    if (isPlatform && canManage && !assignmentError) {
      try {
        const ownerNames = new Map(orgOptions.map(org => [org.id, org.name]));
        const relays = await adminDb.collection('relayDevices').where('status', 'in', ['active', 'paused', 'offline'])
          .select('businessId', 'label', 'status', 'lastHeartbeatAt', 'countryRoutingEnabled', 'allowedCountryCodes').get();
        assignmentOptions = relays.docs.flatMap(relay => {
          const ownerId = relay.get('businessId');
          if (typeof ownerId !== 'string' || !ownerId.trim()) return [];
          const label = relay.get('label');
          return [{
            id: relay.id,
            label: typeof label === 'string' && label.trim() ? label : relay.id,
            owner: ownerNames.get(ownerId) ?? ownerId,
            status: relay.get('status'),
            lastHeartbeatAt: ms(relay.get('lastHeartbeatAt')),
            countryCodes: relay.get('countryRoutingEnabled') === true ? countryCodes(relay.get('allowedCountryCodes')) : [],
          }];
        }).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
      } catch {
        assignmentError = 'Could not load relay devices for assignment.';
      }
    }
  }
  const healthyDevices = coverageDevices.filter(
    d => d.status === 'active' && d.lastHeartbeatAt != null && now - d.lastHeartbeatAt < 90_000,
  ).length;

  // Country coverage view: for each country a configured relay serves, how many
  // are currently active (online) vs offline. "Available" iff ≥1 active relay.
  const coverageMap = new Map<string, { active: number; offline: number }>();
  for (const d of coverageDevices) {
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
        isPlatform={isPlatform}
        fetchError={fetchError}
        queueHealth={queueHealth}
        healthyDevices={healthyDevices}
        orgOptions={orgOptions}
        coverage={coverage}
        assignedDeviceId={assignedDeviceId}
        assignmentOptions={assignmentOptions}
        assignmentError={assignmentError}
      />
    </div>
  );
}
