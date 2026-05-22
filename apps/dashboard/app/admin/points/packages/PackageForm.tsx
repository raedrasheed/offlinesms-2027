'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { PackageActionState } from '@/lib/packageActions';
import type { AdminPackageRow } from '@/lib/adminData';

type Props = {
  action: (prev: PackageActionState, data: FormData) => Promise<PackageActionState>;
  submitLabel: string;
  initial?: AdminPackageRow;
};

const CARD   = '#131B27';
const BORDER = '#1A2437';
const inputCls = 'w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputSx  = { background: '#0D1117', border: '1px solid #1A2437', color: '#E2E8F2' };

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
        <div className="rounded-lg px-4 py-3 text-sm" style={{ background: '#2D0D0D', border: '1px solid #3D1515', color: '#EF4444' }}>{state.error}</div>
      )}

      <div>
        <label className="block text-xs font-bold mb-1" style={{ color: '#94A3B8' }}>
          Package name <span style={{ color: '#EF4444' }}>*</span>
        </label>
        <input name="name" defaultValue={initial?.name ?? ''} required maxLength={80} className={inputCls} style={inputSx} placeholder="e.g. Starter Pack" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: '#94A3B8' }}>Points <span style={{ color: '#EF4444' }}>*</span></label>
          <input name="points" type="number" min={1} defaultValue={initial?.points ?? ''} required className={inputCls} style={inputSx} placeholder="100" />
        </div>
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: '#94A3B8' }}>Bonus points</label>
          <input name="bonusPoints" type="number" min={0} defaultValue={initial?.bonusPoints ?? 0} className={inputCls} style={inputSx} placeholder="0" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: '#94A3B8' }}>Price <span style={{ color: '#EF4444' }}>*</span></label>
          <input name="price" type="number" min={0} step="0.01" defaultValue={initial?.price ?? ''} required className={inputCls} style={inputSx} placeholder="4.99" />
        </div>
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: '#94A3B8' }}>Currency <span style={{ color: '#EF4444' }}>*</span></label>
          <input name="currency" defaultValue={initial?.currency ?? ''} required maxLength={10} className={inputCls} style={inputSx} placeholder="USD" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: '#94A3B8' }}>Status</label>
          <select name="status" defaultValue={initial?.status ?? 'active'} className={inputCls} style={inputSx}>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold mb-1" style={{ color: '#94A3B8' }}>Sort order</label>
          <input name="sortOrder" type="number" defaultValue={initial?.sortOrder ?? 0} className={inputCls} style={inputSx} placeholder="0" />
        </div>
      </div>

      <div className="pt-2 flex items-center gap-3">
        <SubmitButton label={submitLabel} />
        <a href="/admin/points/packages" className="text-sm hover:underline" style={{ color: '#64748B' }}>Cancel</a>
      </div>
    </form>
  );
}
