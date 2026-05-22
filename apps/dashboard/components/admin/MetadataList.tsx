type Item = { label: string; value: React.ReactNode };

type Props = {
  items: Item[];
  columns?: 1 | 2;
};

export default function MetadataList({ items, columns = 1 }: Props) {
  return (
    <dl className={`grid gap-x-8 gap-y-3 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {items.map(item => (
        <div key={item.label} className="flex justify-between items-start py-2 last:border-b-0" style={{ borderBottom: '1px solid var(--c-border)' }}>
          <dt className="text-xs font-semibold shrink-0 mr-4" style={{ color: 'var(--c-text-3)' }}>{item.label}</dt>
          <dd className="text-xs font-medium text-right min-w-0 break-words" style={{ color: 'var(--c-text)' }}>{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
