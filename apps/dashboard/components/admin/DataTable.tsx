import Link from 'next/link';
import { EmptyState, LoadingState, ErrorState } from '@/components/state';

export type Column<T> = {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
};

type Props<T extends Record<string, any>> = {
  columns: Column<T>[];
  rows: T[];
  keyField: keyof T;
  href?: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  nextCursor?: string;
  basePath?: string;
};

export default function DataTable<T extends Record<string, any>>({
  columns, rows, keyField, href,
  loading, error,
  emptyTitle = 'No records',
  emptyDescription,
  nextCursor,
  basePath,
}: Props<T>) {
  if (loading) return <LoadingState compact title="Loading…" />;
  if (error)   return <ErrorState compact title="Load error" description={error} />;

  return (
    <div className="overflow-x-auto rounded-xl border border-ink-100 bg-white">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-surface3 text-left">
            {columns.map(col => (
              <th
                key={col.key}
                className={`px-4 py-3 text-[10px] font-bold text-ink-500 tracking-wide uppercase whitespace-nowrap ${col.className ?? ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-12">
                <EmptyState compact title={emptyTitle} description={emptyDescription} />
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const rowHref = href?.(row);
              const rowClass = `border-t border-ink-100 ${i % 2 === 0 ? 'bg-white' : 'bg-surface3/40'} ${rowHref ? 'hover:bg-primary/5' : ''}`;
              return (
                <tr key={String(row[keyField])} className={rowClass}>
                  {columns.map(col => (
                    <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
                      {rowHref && col === columns[0] ? (
                        <Link href={rowHref as any} className="block">
                          {col.render ? col.render(row) : String(row[col.key] ?? '—')}
                        </Link>
                      ) : (
                        col.render ? col.render(row) : String(row[col.key] ?? '—')
                      )}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {nextCursor && basePath && (
        <div className="px-4 py-3 border-t border-ink-100 text-center">
          <Link href={`${basePath}?cursor=${nextCursor}` as any} className="text-sm text-primary font-semibold hover:underline">
            Load more →
          </Link>
        </div>
      )}
    </div>
  );
}
