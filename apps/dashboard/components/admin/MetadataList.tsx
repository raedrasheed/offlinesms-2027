type Item = { label: string; value: React.ReactNode };

type Props = {
  items: Item[];
  columns?: 1 | 2;
};

export default function MetadataList({ items, columns = 1 }: Props) {
  return (
    <dl className={`grid gap-x-8 gap-y-3 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {items.map(item => (
        <div key={item.label} className="flex justify-between items-start py-2 border-b border-ink-100 last:border-b-0">
          <dt className="text-xs font-semibold text-ink-500 shrink-0 mr-4">{item.label}</dt>
          <dd className="text-xs text-ink-900 font-medium text-right min-w-0 break-words">{item.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
