// Admin settings — server component.
// Reads system settings from Firestore and renders the settings form.
// Update actions are gated by manage:settings capability.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';
import { getSystemSettings } from '@/lib/adminData';
import { PermissionState } from '@/components/state';
import SettingsForm from './SettingsForm';
import { updateSystemSettings } from '@/lib/settingsActions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SettingsPage() {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized') redirect('/login?next=/admin/settings');
  if (!canDo(session.role, 'view:settings')) {
    return <div className="p-8"><PermissionState title="Settings access required" /></div>;
  }

  const canManage = canDo(session.role, 'manage:settings');

  let settings = await getSystemSettings().catch(() => null);
  if (!settings) {
    settings = {
      appName: 'OfflineSMS',
      supportEmail: '',
      defaultLanguage: 'en',
      defaultTimezone: 'UTC',
      smsEscalationEnabled: true,
      pointsEnabled: true,
      maintenanceMode: false,
    };
  }

  return (
    <div className="p-7 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold tracking-tight text-ink-900">System settings</h1>
        <p className="text-sm text-ink-500 mt-0.5">
          {canManage
            ? 'Update safe system configuration. Changes are audit-logged.'
            : 'Read-only — super admin required to update settings.'}
        </p>
      </div>

      {canManage ? (
        <SettingsForm action={updateSystemSettings} initial={settings} />
      ) : (
        <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-6 space-y-4">
          <Row label="App name"          value={settings.appName} />
          <Row label="Support email"     value={settings.supportEmail || '—'} />
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
    <div className="flex justify-between items-center border-b border-ink-50 pb-3 last:border-0 last:pb-0">
      <span className="text-sm text-ink-500">{label}</span>
      <span className="text-sm font-semibold text-ink-900">{value}</span>
    </div>
  );
}
