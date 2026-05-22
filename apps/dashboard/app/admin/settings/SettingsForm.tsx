'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState } from 'react';
import type { SettingsActionState } from '@/lib/settingsActions';
import type { SystemSettings } from '@/lib/adminData';

type Props = {
  action: (prev: SettingsActionState, data: FormData) => Promise<SettingsActionState>;
  initial: SystemSettings;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition disabled:opacity-50"
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
        <p className="text-sm font-semibold text-ink-900">{label}</p>
        <p className="text-xs text-ink-500 mt-0.5">{description}</p>
      </div>
      <label className="relative inline-flex items-center cursor-pointer select-none">
        <input type="hidden" name={name} value={checked ? 'true' : 'false'} />
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => setChecked(v => !v)}
          className={`w-11 h-6 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-ink-300'}`}
        >
          <span
            className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
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
      {state?.error   && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>}
      {state?.success && <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">Settings saved.</div>}

      <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-6 space-y-4">
        <h2 className="text-sm font-extrabold text-ink-900 tracking-tight">General</h2>

        <div>
          <label className="block text-xs font-bold text-ink-700 mb-1">App name <span className="text-red-500">*</span></label>
          <input
            name="appName"
            defaultValue={initial.appName}
            required
            maxLength={60}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-ink-700 mb-1">Support email</label>
          <input
            name="supportEmail"
            type="email"
            defaultValue={initial.supportEmail}
            maxLength={120}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
            placeholder="support@example.com"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-ink-700 mb-1">Default language</label>
            <select
              name="defaultLanguage"
              defaultValue={initial.defaultLanguage}
              className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
            >
              {LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-ink-700 mb-1">Default timezone</label>
            <input
              name="defaultTimezone"
              defaultValue={initial.defaultTimezone}
              maxLength={60}
              className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
              placeholder="UTC"
            />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 p-6 space-y-5">
        <h2 className="text-sm font-extrabold text-ink-900 tracking-tight">Feature flags</h2>

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

        {initial.maintenanceMode && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            Maintenance mode is currently <strong>on</strong>. Toggle is read-only here; change via server config.
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-2">
        <SubmitButton />
        <p className="text-xs text-ink-400">All changes are audit-logged.</p>
      </div>
    </form>
  );
}
