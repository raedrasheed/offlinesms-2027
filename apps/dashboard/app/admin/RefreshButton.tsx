'use client';

import { useRouter } from 'next/navigation';

export default function RefreshButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="px-3 py-1.5 text-xs font-bold rounded-lg transition hover:brightness-110"
      style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', color: 'var(--c-text-2)' }}
    >
      Refresh counts
    </button>
  );
}
