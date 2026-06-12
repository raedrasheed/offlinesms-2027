'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { OrgSendActionState } from '@/lib/orgMessagingActions';

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
      {pending ? 'Sending…' : 'Send message'}
    </button>
  );
}

export default function SendMessageForm({
  action,
}: {
  action: (prev: OrgSendActionState, data: FormData) => Promise<OrgSendActionState>;
}) {
  const router = useRouter();
  const [state, formAction] = useFormState(action, null);
  const ok = state && 'success' in state ? state : null;

  // Refresh server-rendered usage + logs after a successful send.
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
          Batch <span className="font-mono">{ok.batchId}</span> created — {ok.accepted}/{ok.total} accepted{ok.failed > 0 ? `, ${ok.failed} failed` : ''}.
        </div>
      )}

      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
          Title <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <input name="title" required maxLength={80} className={inputCls} style={inputStyle} placeholder="Important notice" />
      </div>

      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
          Body <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <textarea name="body" required maxLength={500} rows={4} className={inputCls} style={inputStyle} placeholder="Message body (max 500 characters)" />
      </div>

      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
          Recipients <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <textarea
          name="recipients"
          required
          rows={6}
          className={`${inputCls} font-mono`}
          style={inputStyle}
          placeholder={'+970591234567\nuserId-abc123\none per line — +E.164 phone or user ID (max 500)'}
        />
        <p className="text-[11px] mt-1" style={{ color: 'var(--c-text-3)' }}>
          One recipient per line: a phone in +E.164 form or an OfflineSMS user ID. Max 500 per send.
        </p>
      </div>

      <SubmitButton />
    </form>
  );
}
