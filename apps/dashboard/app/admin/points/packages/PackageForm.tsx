'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { PackageActionState } from '@/lib/packageActions';
import type { AdminPackageRow } from '@/lib/adminData';

type Props = {
  action: (prev: PackageActionState, data: FormData) => Promise<PackageActionState>;
  submitLabel: string;
  initial?: AdminPackageRow;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2 bg-primary text-white text-sm font-bold rounded-lg hover:bg-primary-dark transition disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

export default function PackageForm({ action, submitLabel, initial }: Props) {
  const [state, formAction] = useFormState(action, null);

  return (
    <form action={formAction} className="space-y-4 bg-white rounded-2xl border border-ink-100 shadow-sh1 p-6">
      {state?.error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{state.error}</div>
      )}

      <div>
        <label className="block text-xs font-bold text-ink-700 mb-1">Package name <span className="text-red-500">*</span></label>
        <input
          name="name"
          defaultValue={initial?.name ?? ''}
          required
          maxLength={80}
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
          placeholder="e.g. Starter Pack"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-ink-700 mb-1">Points <span className="text-red-500">*</span></label>
          <input
            name="points"
            type="number"
            min={1}
            defaultValue={initial?.points ?? ''}
            required
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
            placeholder="100"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-ink-700 mb-1">Bonus points</label>
          <input
            name="bonusPoints"
            type="number"
            min={0}
            defaultValue={initial?.bonusPoints ?? 0}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
            placeholder="0"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-ink-700 mb-1">Price <span className="text-red-500">*</span></label>
          <input
            name="price"
            type="number"
            min={0}
            step="0.01"
            defaultValue={initial?.price ?? ''}
            required
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
            placeholder="4.99"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-ink-700 mb-1">Currency <span className="text-red-500">*</span></label>
          <input
            name="currency"
            defaultValue={initial?.currency ?? ''}
            required
            maxLength={10}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
            placeholder="USD"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-ink-700 mb-1">Status</label>
          <select
            name="status"
            defaultValue={initial?.status ?? 'active'}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
          >
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-ink-700 mb-1">Sort order</label>
          <input
            name="sortOrder"
            type="number"
            defaultValue={initial?.sortOrder ?? 0}
            className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white"
            placeholder="0"
          />
        </div>
      </div>

      <div className="pt-2 flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <a href="/admin/points/packages" className="text-sm text-ink-500 hover:text-ink-900">Cancel</a>
      </div>
    </form>
  );
}
