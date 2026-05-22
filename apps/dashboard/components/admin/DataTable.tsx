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

  const CARD = 'var(--c-card)';
  const BORDER = 'var(--c-border)';

  return (
    <div className="overflow-x-auto rounded-xl" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {columns.map(col => (
              <th
                key={col.key}
                className={`px-4 py-3 text-left text-[10px] font-bold tracking-wide uppercase whitespace-nowrap ${col.className ?? ''}`}
                style={{ color: 'var(--c-text-4)' }}
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
              return (
                <tr
                  key={String(row[keyField])}
                  className={rowHref ? 'transition hover:bg-white/[0.03]' : ''}
                  style={i < rows.length - 1 ? { borderBottom: `1px solid ${BORDER}` } : {}}
                >
                  {columns.map(col => (
                    <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`} style={{ color: 'var(--c-text-2)' }}>
                      {rowHref && col === columns[0] ? (
                        <Link href={rowHref as any} className="block" style={{ color: 'var(--c-text)' }}>
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
        <div className="px-4 py-3 text-center" style={{ borderTop: `1px solid ${BORDER}` }}>
          <Link href={`${basePath}?cursor=${nextCursor}` as any} className="text-sm font-semibold hover:underline" style={{ color: '#5BB6DE' }}>
            Load more →
          </Link>
        </div>
      )}
    </div>
  );
}
