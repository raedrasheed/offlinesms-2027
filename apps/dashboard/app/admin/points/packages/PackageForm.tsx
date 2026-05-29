'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { PackageActionState } from '@/lib/packageActions';
import type { AdminPackageRow } from '@/lib/adminData';

type Props = {
  action: (prev: PackageActionState, data: FormData) => Promise<PackageActionState>;
  submitLabel: string;
  initial?: AdminPackageRow;
};

const CARD   = 'var(--c-card)';
const BORDER = 'var(--c-border)';
const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputSx  = { background: 'var(--c-bg)', border: '1px solid var(--c-border)', color: 'var(--c-text)' };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2 text-sm font-bold rounded-lg transition hover:brightness-110 disabled:opacity-50"
      style={{ background: '#1F7BA8', color: '#fff' }}
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

export default function PackageForm({ action, submitLabel, initial }: Props) {
  const [state, formAction] = useFormState(action, null);

  return (
    <form action={formAction} className="space-y-4 rounded-2xl p-6" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      {state?.error && (
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--c-error-bg)', border: '1px solid var(--c-error-border)', color: '#EF4444' }}>{state.error}</div>
      )}

      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>
          Package name <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <input name="name" defaultValue={initial?.name ?? ''} required maxLength={80} className={inputCls} style={inputSx} placeholder="e.g. Starter Pack" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Points <span style={{ color: '#EF4444' }}>*</span></label>
          <input name="points" type="number" min={1} defaultValue={initial?.points ?? ''} required className={inputCls} style={inputSx} placeholder="100" />
        </div>
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Bonus points</label>
          <input name="bonusPoints" type="number" min={0} defaultValue={initial?.bonusPoints ?? 0} className={inputCls} style={inputSx} placeholder="0" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Price <span style={{ color: '#EF4444' }}>*</span></label>
          {/* Entered/displayed in major units (dollars); stored as cents. */}
          <input name="price" type="number" min={0} step="0.01" defaultValue={initial ? (initial.price / 100).toFixed(2) : ''} required className={inputCls} style={inputSx} placeholder="4.99" />
        </div>
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Currency <span style={{ color: '#EF4444' }}>*</span></label>
          <input name="currency" defaultValue={initial?.currency ?? ''} required maxLength={10} className={inputCls} style={inputSx} placeholder="USD" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Status</label>
          <select name="status" defaultValue={initial?.status ?? 'active'} className={inputCls} style={inputSx}>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: 'var(--c-text-2)' }}>Sort order</label>
          <input name="sortOrder" type="number" defaultValue={initial?.sortOrder ?? 0} className={inputCls} style={inputSx} placeholder="0" />
        </div>
      </div>

      <div className="pt-2 flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <a href="/admin/points/packages" className="text-sm hover:underline" style={{ color: 'var(--c-text-3)' }}>Cancel</a>
      </div>
    </form>
  );
}
