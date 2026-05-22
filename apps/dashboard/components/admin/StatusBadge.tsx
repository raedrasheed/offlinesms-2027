const PRESETS: Record<string, { bg: string; fg: string; label?: string }> = {
  active:    { bg: 'bg-emerald-50', fg: 'text-emerald-700' },
  suspended: { bg: 'bg-red-50',     fg: 'text-red-700' },
  blocked:   { bg: 'bg-red-50',     fg: 'text-red-700' },
  locked:    { bg: 'bg-amber-50',   fg: 'text-amber-700' },
  inactive:  { bg: 'bg-gray-50',    fg: 'text-gray-500' },
  disabled:  { bg: 'bg-gray-50',    fg: 'text-gray-500' },
  pending:   { bg: 'bg-blue-50',    fg: 'text-blue-700' },
  completed: { bg: 'bg-emerald-50', fg: 'text-emerald-700' },
  failed:    { bg: 'bg-red-50',     fg: 'text-red-700' },
  owner:     { bg: 'bg-purple-50',  fg: 'text-purple-700' },
  admin:     { bg: 'bg-blue-50',    fg: 'text-blue-700' },
  member:    { bg: 'bg-gray-50',    fg: 'text-gray-600' },
};

type Props = {
  status: string;
  label?: string;
};

export default function StatusBadge({ status, label }: Props) {
  const p = PRESETS[status.toLowerCase()] ?? { bg: 'bg-gray-50', fg: 'text-gray-600' };
  return (
    <span className={`inline-block text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full ${p.bg} ${p.fg}`}>
      {label ?? status.toUpperCase()}
    </span>
  );
}
