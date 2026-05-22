'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { SupportActionState } from '@/lib/supportActions';

type Props = {
  action: (prev: SupportActionState, data: FormData) => Promise<SupportActionState>;
  currentStatus: string;
};

const STATUSES = ['open', 'pending', 'resolved', 'closed'] as const;

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition disabled:opacity-50"
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
        className="border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
      >
        {STATUSES.map(s => (
          <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</option>
        ))}
      </select>
      <SubmitButton />
      {state?.error  && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-emerald-600">Status updated.</p>}
    </form>
  );
}
