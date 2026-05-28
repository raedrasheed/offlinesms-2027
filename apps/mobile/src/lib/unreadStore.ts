// Phase 23 — tiny shared store for the total unread count, so the bottom Chats
// tab badge reflects what ChatsList computes (ChatsList stays mounted across
// tabs, so it keeps the total fresh even when another tab is active).

import { useEffect, useState } from 'react';

let total = 0;
const listeners = new Set<(n: number) => void>();

export function setUnreadTotal(n: number): void {
  if (n === total) return;
  total = n;
  for (const l of listeners) l(n);
}

export function useUnreadTotal(): number {
  const [n, setN] = useState(total);
  useEffect(() => {
    const l = (v: number) => setN(v);
    listeners.add(l);
    setN(total);
    return () => { listeners.delete(l); };
  }, []);
  return n;
}
