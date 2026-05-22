'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Loader2 } from 'lucide-react';
import type { SearchGroup, SearchResult } from '@/app/admin/search/route';

function StatusDot({ status }: { status?: string }) {
  const cls =
    status === 'active' || status === 'success' ? 'bg-emerald-400'
    : status === 'frozen' || status === 'failure' || status === 'failed' ? 'bg-red-400'
    : status === 'open' || status === 'pending' ? 'bg-amber-400'
    : 'bg-ink-300';
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

export default function AdminGlobalSearchShell() {
  const router = useRouter();
  const [open, setOpen]       = useState(false);
  const [q, setQ]             = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups]   = useState<SearchGroup[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpen  = useCallback(() => setOpen(true),  []);
  const handleClose = useCallback(() => { setOpen(false); setQ(''); setGroups([]); setSelected(0); }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setOpen(v => !v); }
      if (e.key === 'Escape') handleClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const allResults = groups.flatMap(g => g.results);

  function onQueryChange(val: string) {
    setQ(val);
    setSelected(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setGroups([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/admin/search?q=${encodeURIComponent(val.trim())}`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setGroups(data.groups ?? []);
        } else {
          setGroups([]);
        }
      } catch {
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, allResults.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && allResults[selected]) {
      navigate(allResults[selected]);
    }
  }

  function navigate(result: SearchResult) {
    handleClose();
    router.push(result.href as any);
  }

  let globalIdx = 0;

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
          className="fixed inset-0 bg-black/40 z-50 grid place-items-start pt-28"
          onClick={handleClose}
        >
          <div
            className="bg-white rounded-2xl shadow-sh2 w-full max-w-lg mx-auto overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-ink-100">
              {loading
                ? <Loader2 size={16} className="text-ink-400 shrink-0 animate-spin" />
                : <Search size={16} className="text-ink-400 shrink-0" />}
              <input
                ref={inputRef}
                value={q}
                onChange={e => onQueryChange(e.target.value)}
                onKeyDown={onKeyDown}
                className="flex-1 text-sm outline-none text-ink-900 placeholder-ink-400"
                placeholder="Search users, groups, SMS batches…"
                autoComplete="off"
              />
              <button onClick={handleClose} className="text-ink-400 hover:text-ink-700 transition">
                <X size={16} />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-[420px] overflow-y-auto">
              {q.trim().length < 2 ? (
                <div className="px-4 py-8 text-center text-sm text-ink-400">
                  Type at least 2 characters to search.
                </div>
              ) : loading && groups.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-ink-400">Searching…</div>
              ) : groups.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-ink-400">
                  No results for <strong className="text-ink-600">{q}</strong>
                </div>
              ) : (
                <div className="py-2">
                  {groups.map(group => (
                    <div key={group.label}>
                      <div className="px-4 py-1.5 text-[10px] font-bold text-ink-400 uppercase tracking-widest">
                        {group.label}
                      </div>
                      {group.results.map(result => {
                        const idx = globalIdx++;
                        const isSelected = idx === selected;
                        return (
                          <button
                            key={`${result.type}-${result.href}-${idx}`}
                            onClick={() => navigate(result)}
                            onMouseEnter={() => setSelected(idx)}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition ${isSelected ? 'bg-primary/10' : 'hover:bg-surface3'}`}
                          >
                            <StatusDot status={result.status} />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-ink-900 truncate">{result.title}</div>
                              <div className="text-xs text-ink-500 truncate">{result.subtitle}</div>
                            </div>
                            {isSelected && <span className="text-[10px] text-ink-400 shrink-0">↵</span>}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {groups.length > 0 && (
              <div className="border-t border-ink-100 px-4 py-2 flex items-center gap-4 text-[10px] text-ink-400">
                <span>↑↓ navigate</span><span>↵ open</span><span>Esc close</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
