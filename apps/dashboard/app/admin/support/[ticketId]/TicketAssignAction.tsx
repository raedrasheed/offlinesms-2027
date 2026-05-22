'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { SupportActionState } from '@/lib/supportActions';

type Props = {
  action: (prev: SupportActionState, data: FormData) => Promise<SupportActionState>;
  currentAssignee: string | null;
};

const inputStyle = { background: 'var(--c-bg)', border: '1px solid var(--c-border)', color: 'var(--c-text)' };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
      style={{ background: '#1F7BA8', color: '#fff' }}
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

export default function TicketAssignAction({ action, currentAssignee }: Props) {
  const [state, formAction] = useFormState(action, null);

  return (
    <div className="space-y-3">
      {currentAssignee && (
        <p className="text-xs" style={{ color: 'var(--c-text-3)' }}>
          Currently assigned to: <span className="font-mono" style={{ color: 'var(--c-text)' }}>{currentAssignee}</span>
        </p>
      )}

      <form action={formAction} className="flex items-center gap-3">
        <input
          type="text"
          name="assigneeUid"
          placeholder="Assignee UID (leave blank to unassign)"
          defaultValue={currentAssignee ?? ''}
          className="flex-1 rounded-lg px-3 py-2 text-sm outline-none font-mono"
          style={inputStyle}
          maxLength={128}
        />
        <SubmitButton label={currentAssignee ? 'Reassign' : 'Assign'} />
        {currentAssignee && (
          <UnassignButton action={formAction} />
        )}
      </form>

      {state?.error   && <p className="text-xs" style={{ color: '#EF4444' }}>{state.error}</p>}
      {state?.success && <p className="text-xs" style={{ color: '#22C55E' }}>Assignment updated.</p>}
    </div>
  );
}

function UnassignButton({ action }: { action: (data: FormData) => void }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set('assigneeUid', '');
        action(fd);
      }}
      className="px-3 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
      style={{ background: 'var(--c-card)', color: 'var(--c-text-2)', border: '1px solid var(--c-border)' }}
    >
      Unassign
    </button>
  );
}
