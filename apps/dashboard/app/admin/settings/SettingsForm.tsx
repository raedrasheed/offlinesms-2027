'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import type { SettingsActionState } from '@/lib/settingsActions';
import type { SystemSettings } from '@/lib/adminData';

type Props = {
  action: (prev: SettingsActionState, data: FormData) => Promise<SettingsActionState>;
  initial: SystemSettings;
};

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';

const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputStyle = { background: 'var(--c-bg)', border: '1px solid var(--c-border)', color: 'var(--c-text)' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
      style={{ background: '#1F7BA8', color: '#fff' }}
    >
      {pending ? 'Saving…' : 'Save settings'}
    </button>
  );
}

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic' },
  { value: 'fr', label: 'French' },
  { value: 'es', label: 'Spanish' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
];

function Toggle({
  label, description, name, initialValue,
}: { label: string; description: string; name: string; initialValue: boolean }) {
  const [checked, setChecked] = useState(initialValue);
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer select-none">
        <input type="hidden" name={name} value={checked ? 'true' : 'false'} />
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => setChecked(v => !v)}
          className="w-11 h-6 rounded-full transition-colors"
          style={{ background: checked ? '#1F7BA8' : 'var(--c-border)' }}
        >
          <span
            className={`block w-5 h-5 rounded-full shadow transition-transform mx-0.5 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
            style={{ background: 'var(--c-text)' }}
          />
        </button>
      </label>
    </div>
  );
}

export default function SettingsForm({ action, initial }: Props) {
  const [state, formAction] = useFormState(action, null);

  return (
    <form action={formAction} className="space-y-5">
      {state?.error   && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>
          {state.error}
        </div>
      )}
      {state?.success && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--c-success-bg)', border: '1px solid var(--c-success-border)', color: '#22C55E' }}>
          Settings saved.
        </div>
      )}

      <div className="rounded-2xl p-6 space-y-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <h2 className="text-sm font-extrabold tracking-tight" style={{ color: 'var(--c-text)' }}>General</h2>

        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
            App name <span style={{ color: '#EF4444' }}>*</span>
          </label>
          <input
            name="appName"
            defaultValue={initial.appName}
            required
            maxLength={60}
            className={inputCls}
            style={inputStyle}
          />
        </div>

        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Support email</label>
          <input
            name="supportEmail"
            type="email"
            defaultValue={initial.supportEmail}
            maxLength={120}
            className={inputCls}
            style={inputStyle}
            placeholder="support@example.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Default language</label>
            <select
              name="defaultLanguage"
              defaultValue={initial.defaultLanguage}
              className={inputCls}
              style={inputStyle}
            >
              {LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Default timezone</label>
            <input
              name="defaultTimezone"
              defaultValue={initial.defaultTimezone}
              maxLength={60}
              className={inputCls}
              style={inputStyle}
              placeholder="UTC"
            />
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-6 space-y-5" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <h2 className="text-sm font-extrabold tracking-tight" style={{ color: 'var(--c-text)' }}>Feature flags</h2>

        <Toggle
          label="SMS escalation"
          description="Allow users to escalate group messages via SMS."
          name="smsEscalationEnabled"
          initialValue={initial.smsEscalationEnabled}
        />

        <Toggle
          label="Points system"
          description="Enable the OfflineSMS Points wallet and purchase flow."
          name="pointsEnabled"
          initialValue={initial.pointsEnabled}
        />

        <Toggle
          label="Email sign-in"
          description="Allow users to sign in with email and password."
          name="emailSignInEnabled"
          initialValue={initial.emailSignInEnabled}
        />

        {initial.maintenanceMode && (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--c-warning-bg)', border: '1px solid var(--c-warning-border)', color: '#F59E0B' }}>
            Maintenance mode is currently <strong>on</strong>. Toggle is read-only here; change via server config.
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <SubmitButton />
        <p className="text-xs" style={{ color: 'var(--c-text-4)' }}>All changes are audit-logged.</p>
      </div>
    </form>
  );
}
