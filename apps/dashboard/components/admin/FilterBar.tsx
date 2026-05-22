'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { useCallback } from 'react';

type FilterOption = { value: string; label: string };

type Props = {
  searchPlaceholder?: string;
  filters?: { key: string; label: string; options: FilterOption[] }[];
};

export default function FilterBar({ searchPlaceholder = 'Search…', filters = [] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const update = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete('cursor');
    router.push(`${pathname}?${params.toString()}` as any);
  }, [router, pathname, searchParams]);

  const inputStyle = {
    background: 'var(--c-card)',
    border: '1px solid var(--c-border)',
    color: 'var(--c-text)',
  } as const;

  return (
    <div className="flex items-center gap-3 mb-5 flex-wrap">
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2 min-w-[200px] flex-1 max-w-xs"
        style={inputStyle}
      >
        <Search size={13} style={{ color: 'var(--c-text-4)' }} />
        <input
          placeholder={searchPlaceholder}
          defaultValue={searchParams?.get('q') ?? ''}
          onChange={e => update('q', e.target.value)}
          className="bg-transparent text-sm flex-1 outline-none"
          style={{ color: 'var(--c-text)' }}
        />
      </div>
      {filters.map(f => (
        <select
          key={f.key}
          defaultValue={searchParams?.get(f.key) ?? ''}
          onChange={e => update(f.key, e.target.value)}
          className="rounded-lg px-3 py-2 text-sm outline-none"
          style={inputStyle}
        >
          <option value="">{f.label}</option>
          {f.options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
    </div>
  );
}
