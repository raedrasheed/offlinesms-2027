'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { SupportActionState } from '@/lib/supportActions';

type Props = {
  action: (prev: SupportActionState, data: FormData) => Promise<SupportActionState>;
  currentStatus: string;
};

const STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;

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
      {pending ? 'Saving…' : 'Update status'}
    </button>
  );
}

export default function TicketStatusAction({ action, currentStatus }: Props) {
  const [state, formAction] = useFormState(action, null);

  return (
    <form action={formAction} className="flex items-center gap-3">
      <select
        name="status"
        defaultValue={currentStatus}
        className="rounded-lg px-3 py-2 text-sm outline-none"
        style={inputStyle}
      >
        {STATUSES.map(s => (
          <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
        ))}
      </select>
      <SubmitButton />
      {state?.error   && <p className="text-xs" style={{ color: '#EF4444' }}>{state.error}</p>}
      {state?.success && <p className="text-xs" style={{ color: '#22C55E' }}>Status updated.</p>}
    </form>
  );
}
