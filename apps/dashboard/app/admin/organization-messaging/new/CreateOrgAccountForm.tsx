'use client';

import { useFormState, useFormStatus } from 'react-dom';
import Link from 'next/link';
import type { OrgAccountActionState } from '@/lib/orgMessagingActions';

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
      {pending ? 'Creating…' : 'Create organization account'}
    </button>
  );
}

export default function CreateOrgAccountForm({
  action,
}: {
  action: (prev: OrgAccountActionState, data: FormData) => Promise<OrgAccountActionState>;
}) {
  const [state, formAction] = useFormState(action, null);
  const ok = state && 'success' in state ? state : null;

  return (
    <form action={formAction} className="space-y-5">
      {state && 'error' in state && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>
          {state.error}
        </div>
      )}
      {ok && (
        <div className="rounded-lg px-4 py-3 text-sm space-y-1" style={{ background: 'var(--c-success-bg)', border: '1px solid var(--c-success-border)', color: '#22C55E' }}>
          <p className="font-bold">Organization account created.</p>
          <p>The admin can now sign in with the email and password you set.</p>
          <Link href={`/admin/organization-messaging?org=${ok.organizationId}` as any} className="underline font-semibold">
            Open organization messaging →
          </Link>
        </div>
      )}

      <div className="rounded-2xl p-6 space-y-4" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
            Organization name <span style={{ color: '#EF4444' }}>*</span>
          </label>
          <input name="name" required maxLength={120} className={inputCls} style={inputStyle} placeholder="Acme University" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
              Admin email <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input name="email" type="email" required className={inputCls} style={inputStyle} placeholder="admin@acme.edu" />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
              Admin password <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input name="password" type="password" required minLength={8} className={inputCls} style={inputStyle} placeholder="At least 8 chars, a letter + a number" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
              Monthly message limit <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input name="monthlyMessageLimit" type="number" min={1} step={1} required defaultValue={1000} className={inputCls} style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Status</label>
            <select name="status" defaultValue="active" className={inputCls} style={inputStyle}>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>
        </div>
      </div>

      <SubmitButton />
    </form>
  );
}
