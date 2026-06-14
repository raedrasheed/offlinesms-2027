'use client';

// SMS escalation settings — the org admin sets the check period (minutes)
// and which recipients get the SMS after it elapses, mirroring the app's
// escalation options: unread only / undelivered only / everyone.

import { useFormState, useFormStatus } from 'react-dom';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { OrgEscalationActionState } from '@/lib/orgMessagingActions';
import type { EscalationPolicy } from '@/lib/orgMessagingValidation';

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
      {pending ? 'Saving…' : 'Save escalation settings'}
    </button>
  );
}

export default function EscalationSettings({
  initial, action,
}: {
  initial: EscalationPolicy;
  action: (prev: OrgEscalationActionState, data: FormData) => Promise<OrgEscalationActionState>;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(action, null);
  const [enabled, setEnabled] = useState(initial.enabled);
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
          Escalation settings saved.
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--c-text)' }}>Auto SMS escalation</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--c-text-3)' }}>
            After the check period, recipients still matching the audience get the message by SMS (billed from the org points wallet).
          </p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer select-none">
          <input type="hidden" name="escalationEnabled" value={enabled ? 'true' : 'false'} />
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled(v => !v)}
            className="w-11 h-6 rounded-full transition-colors"
            style={{ background: enabled ? '#1F7BA8' : 'var(--c-border)' }}
          >
            <span
              className={`block w-5 h-5 rounded-full shadow transition-transform mx-0.5 ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
              style={{ background: 'var(--c-text)' }}
            />
          </button>
        </label>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
            Check period (minutes)
          </label>
          <input
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
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
            Send SMS to
          </label>
          <select name="audience" defaultValue={initial.audience} className={inputCls} style={inputStyle}>
            <option value="unread_only">Unread users only</option>
            <option value="undelivered_only">Undelivered users only</option>
            <option value="everyone">All users</option>
          </select>
          <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
            Same options as the OfflineSMS app’s escalation.
          </p>
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
