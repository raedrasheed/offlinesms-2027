'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { NotificationActionState } from './notificationActions';

type Props = {
  action: (prev: NotificationActionState, data: FormData) => Promise<NotificationActionState>;
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition disabled:opacity-50"
    >
      {pending ? 'Saving…' : 'Save draft'}
    </button>
  );
}

export default function DraftForm({ action }: Props) {
  const [state, formAction] = useFormState(action, null);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-ink-700 mb-1">Title <span className="text-ink-400 font-normal">(max 140 chars)</span></label>
        <input
          type="text"
          name="title"
          required
          maxLength={140}
          placeholder="Notification title"
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white focus:border-primary"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-ink-700 mb-1">Body <span className="text-ink-400 font-normal">(max 500 chars)</span></label>
        <textarea
          name="body"
          required
          maxLength={500}
          rows={4}
          placeholder="Notification body text…"
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white focus:border-primary resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-ink-700 mb-1">Audience</label>
        <select
          name="audience"
          className="border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
        >
          <option value="all">All users</option>
          <option value="organization">Organization members</option>
          <option value="group">Group members</option>
        </select>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <SubmitButton />
        <button
          type="button"
          disabled
          title="Broadcast sending will be enabled after notification infrastructure is implemented."
          className="px-4 py-2 bg-ink-100 text-ink-400 text-sm font-bold rounded-lg cursor-not-allowed border border-ink-200"
        >
          Send broadcast
        </button>
        <span className="text-[10px] text-ink-400 italic max-w-[260px]">
          Broadcast sending will be enabled after notification infrastructure is implemented.
        </span>
      </div>

      {state?.error   && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && (
        <p className="text-xs text-emerald-600">Draft saved (ID: <span className="font-mono">{state.id}</span>).</p>
      )}
    </form>
  );
}
