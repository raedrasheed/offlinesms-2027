'use client';

// SMS escalation settings — the org admin sets the check period (minutes)
// and which recipients get the SMS after it elapses, mirroring the app's
// escalation options: unread only / undelivered only / everyone.

import { useFormState, useFormStatus } from 'react-dom';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { OrgEscalationActionState } from '@/lib/orgMessagingActions';
import type { EscalationPolicy, OrgSmsIdentification } from '@/lib/orgMessagingValidation';

const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputStyle = { background: 'var(--c-bg)', border: '1px solid var(--c-border)', color: 'var(--c-text)' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
      style={{ background: '#1F7BA8', color: '#fff' }}
    >
      {pending ? 'Saving…' : 'Save SMS settings'}
    </button>
  );
}

function SettingSwitch({ name, label, description, checked, onChange }: {
  name: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>{description}</p>
      </div>
      <input type="hidden" name={name} value={checked ? 'true' : 'false'} />
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="w-11 h-6 shrink-0 rounded-full transition-colors"
        style={{ background: checked ? '#1F7BA8' : 'var(--c-border)' }}
      >
        <span
          className={`block w-5 h-5 rounded-full shadow transition-transform mx-0.5 ${checked ? 'translate-x-5' : 'translate-x-0'}`}
          style={{ background: 'var(--c-text)' }}
        />
      </button>
    </div>
  );
}

export default function EscalationSettings({
  initial, smsIdentification, action,
}: {
  initial: EscalationPolicy;
  smsIdentification: OrgSmsIdentification;
  action: (prev: OrgEscalationActionState, data: FormData) => Promise<OrgEscalationActionState>;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(action, null);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [showOrganizationName, setShowOrganizationName] = useState(smsIdentification.showOrganizationName);
  const [showRecipientGroupName, setShowRecipientGroupName] = useState(smsIdentification.showRecipientGroupName);
  const ok = state && 'success' in state;

  useEffect(() => { if (ok) router.refresh(); }, [ok, router]);

  return (
    <form action={formAction} className="space-y-4">
      {state && 'error' in state && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>
          {state.error}
        </div>
      )}
      {ok && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--c-success-bg)', border: '1px solid var(--c-success-border)', color: '#22C55E' }}>
          SMS settings saved.
        </div>
      )}

      <SettingSwitch
        name="escalationEnabled"
        label="Auto SMS escalation"
        description="After the check period, unregistered numbers and registered recipients matching the audience can get the message by SMS. Each segment is billed from the organization’s points wallet."
        checked={enabled}
        onChange={setEnabled}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="org-escalation-delay" className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
            Check period (minutes)
          </label>
          <input
            id="org-escalation-delay"
            name="delayMinutes"
            type="number"
            min={1}
            max={1440}
            step={1}
            required
            defaultValue={initial.delayMinutes}
            className={inputCls}
            style={inputStyle}
          />
          <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
            How long to wait before checking delivery/read status (1–1440).
          </p>
        </div>
        <div>
          <label htmlFor="org-escalation-audience" className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
            Send SMS to
          </label>
          <select id="org-escalation-audience" name="audience" defaultValue={initial.audience} className={inputCls} style={inputStyle}>
            <option value="unread_only">Unread users only</option>
            <option value="undelivered_only">Undelivered users only</option>
            <option value="everyone">All users</option>
          </select>
          <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
            Same options as the OfflineSMS app’s escalation.
          </p>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Names in SMS</legend>
        <SettingSwitch
          name="smsShowOrganizationName"
          label="Show organization name"
          description="Include the organization’s name in its outgoing SMS messages."
          checked={showOrganizationName}
          onChange={setShowOrganizationName}
        />
        <SettingSwitch
          name="smsShowRecipientGroupName"
          label="Show recipient group name"
          description="Include the group name when sending to a saved recipient group."
          checked={showRecipientGroupName}
          onChange={setShowRecipientGroupName}
        />
        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
          Names and separators count toward the SMS segment cost.
        </p>
      </fieldset>

      <SubmitButton />
    </form>
  );
}
