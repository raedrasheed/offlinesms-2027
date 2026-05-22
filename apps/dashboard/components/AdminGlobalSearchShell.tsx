'use client';
import { useState, useEffect, useCallback } from 'react';
import { Search, X } from 'lucide-react';

export default function AdminGlobalSearchShell() {
  const [open, setOpen] = useState(false);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-2 bg-surface3 rounded-lg px-3 py-2 text-ink-500 w-72 text-sm hover:bg-ink-50 transition"
        aria-label="Open global search"
      >
        <Search size={14} />
        <span className="flex-1 text-left text-ink-400">Search…</span>
        <span className="font-mono text-[10px] bg-white border border-ink-200 rounded px-1.5 py-0.5 text-ink-400">⌘K</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 grid place-items-start pt-32"
          onClick={handleClose}
        >
          <div
            className="bg-white rounded-2xl shadow-sh2 w-full max-w-lg mx-auto overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-100">
              <Search size={16} className="text-ink-400 shrink-0" />
              <input
                autoFocus
                className="flex-1 text-sm outline-none text-ink-900 placeholder-ink-400"
                placeholder="Search users, groups, messages…"
              />
              <button onClick={handleClose} className="text-ink-400 hover:text-ink-700 transition">
                <X size={16} />
              </button>
            </div>
            <div className="px-4 py-8 text-center text-sm text-ink-400">
              Full search coming in a future update.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
