'use client';

// Interactive filter controls for the support queue. Split out of the
// server-rendered page because event handlers (onChange/onBlur) can't be
// passed from a server component — doing so throws a server-side exception.

import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';

const selectStyle = {
  background: 'var(--c-card)',
  border: '1px solid var(--c-border)',
  color: 'var(--c-text)',
};

export default function SupportFilters({
  categoryFilter, assignedToFilter,
}: {
  categoryFilter: string;
  assignedToFilter: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function apply(key: string, value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('cursor');
    const qs = params.toString();
    // Cast for Next's experimental typedRoutes: a dynamically-built path
    // isn't a statically-known Route literal.
    router.push((`/admin/support${qs ? `?${qs}` : ''}`) as Route);
  }

  return (
    <div className="ml-auto flex items-center gap-2">
      <select
        defaultValue={categoryFilter}
        onChange={e => apply('category', e.target.value)}
        className="rounded-lg px-3 py-1.5 text-[11px] outline-none"
        style={selectStyle}
      >
        <option value="">All categories</option>
        <option value="billing">Billing</option>
        <option value="technical">Technical</option>
        <option value="account">Account</option>
        <option value="other">Other</option>
      </select>
      <input
        type="text"
        placeholder="Assigned to (UID)"
        defaultValue={assignedToFilter}
        onBlur={e => apply('assignedTo', e.target.value.trim())}
        className="rounded-lg px-3 py-1.5 text-[11px] outline-none font-mono w-36"
        style={selectStyle}
      />
    </div>
  );
}
