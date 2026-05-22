'use client';

import { useRouter } from 'next/navigation';

export default function RefreshButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.refresh()}
      className="px-3 py-1.5 text-xs font-bold rounded-lg transition hover:brightness-110"
      style={{ background: '#131B27', border: '1px solid #1A2437', color: '#94A3B8' }}
    >
      Refresh counts
    </button>
  );
}
