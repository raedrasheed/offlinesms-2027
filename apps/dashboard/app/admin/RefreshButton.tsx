'use client';

import { useRouter } from 'next/navigation';

export default function RefreshButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="px-3 py-1.5 bg-surface3 border border-ink-200 text-ink-600 text-xs font-bold rounded-lg hover:bg-ink-100 transition"
    >
      Refresh counts
    </button>
  );
}
