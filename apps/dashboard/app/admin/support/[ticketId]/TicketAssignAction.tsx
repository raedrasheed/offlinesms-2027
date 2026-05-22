'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { SupportActionState } from '@/lib/supportActions';

type Props = {
  action: (prev: SupportActionState, data: FormData) => Promise<SupportActionState>;
  currentAssignee: string | null;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition disabled:opacity-50"
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
        <p className="text-xs text-ink-500">
          Currently assigned to: <span className="font-mono text-ink-800">{currentAssignee}</span>
        </p>
      )}

      <form action={formAction} className="flex items-center gap-3">
        <input
          type="text"
          name="assigneeUid"
          placeholder="Assignee UID (leave blank to unassign)"
          defaultValue={currentAssignee ?? ''}
          className="flex-1 border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white font-mono"
          maxLength={128}
        />
        <SubmitButton label={currentAssignee ? 'Reassign' : 'Assign'} />
        {currentAssignee && (
          <UnassignButton action={formAction} />
        )}
      </form>

      {state?.error   && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-emerald-600">Assignment updated.</p>}
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
      className="px-3 py-2 bg-surface3 border border-ink-200 text-ink-600 text-sm font-bold rounded-lg hover:bg-ink-100 transition disabled:opacity-50"
    >
      Unassign
    </button>
  );
}
