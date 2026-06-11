// Admin settings — server component.
// Reads system settings from Firestore and renders the settings form.
// Update actions are gated by manage:settings capability.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getAdminScope } from '@/lib/adminScope';
import { getSystemSettings, listOrganizations } from '@/lib/adminData';
import { adminDb } from '@/lib/firebase-admin';
import { PermissionState } from '@/components/state';
import SettingsForm from './SettingsForm';
import OtpSenderSetting from './OtpSenderSetting';
import { updateSystemSettings } from '@/lib/settingsActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

export default async function SettingsPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/settings');
  if (!canDo(session.role, 'view:settings')) {
    return <div className="p-8"><PermissionState title="Settings access required" /></div>;
  }

  const canManage = canDo(session.role, 'manage:settings');
  // The default OTP sender is a platform-global setting — only unrestricted
  // (super/legacy/bootstrap) admins may view or change it.
  const isPlatformAdmin = canManage && getAdminScope(session).organizationId === undefined;

  let otpOrgOptions: { id: string; name: string }[] = [];
  let otpOrgId: string | null = null;
  if (isPlatformAdmin) {
    try { otpOrgOptions = (await listOrganizations()).map(o => ({ id: o.id ?? '', name: o.name })); } catch { /* soft-fail */ }
    try { otpOrgId = (await adminDb.collection('smsConfig').doc('otp').get()).data()?.businessId ?? null; } catch { /* soft-fail */ }
  }

  let settings = await getSystemSettings().catch(() => null);
  if (!settings) {
    settings = {
      appName: 'OfflineSMS',
      supportEmail: '',
      appVersion: '',
      defaultLanguage: 'en',
      defaultTimezone: 'UTC',
      smsEscalationEnabled: true,
      pointsEnabled: true,
      maintenanceMode: false,
    };
  }

  return (
    <div className="p-6 max-w-2xl space-y-5" style={{ color: 'var(--c-text)' }}>
      <div>
        <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--c-text-3)' }}>Admin / Settings</p>
        <h1 className="text-[22px] font-extrabold tracking-tight">System settings</h1>
        <p className="text-[13px] mt-0.5" style={{ color: 'var(--c-text-3)' }}>
          {canManage
            ? 'Update safe system configuration. Changes are audit-logged.'
            : 'Read-only — super admin required to update settings.'}
        </p>
      </div>

      {canManage ? (
        <>
          <SettingsForm action={updateSystemSettings} initial={settings} />
          {isPlatformAdmin && <OtpSenderSetting orgOptions={otpOrgOptions} otpOrgId={otpOrgId} />}
        </>
      ) : (
        <div className="rounded-2xl p-6 space-y-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
          <Row label="App name"          value={settings.appName} />
          <Row label="Support email"     value={settings.supportEmail || '—'} />
          <Row label="App version"       value={settings.appVersion || '—'} />
          <Row label="Default language"  value={settings.defaultLanguage} />
          <Row label="Default timezone"  value={settings.defaultTimezone} />
          <Row label="SMS escalation"    value={settings.smsEscalationEnabled ? 'Enabled' : 'Disabled'} />
          <Row label="Points system"     value={settings.pointsEnabled ? 'Enabled' : 'Disabled'} />
          <Row label="Maintenance mode"  value={settings.maintenanceMode ? 'On' : 'Off'} />
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center pb-3 last:pb-0" style={{ borderBottom: '1px solid var(--c-border)' }}>
      <span className="text-sm" style={{ color: 'var(--c-text-3)' }}>{label}</span>
      <span className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>{value}</span>
    </div>
  );
}
