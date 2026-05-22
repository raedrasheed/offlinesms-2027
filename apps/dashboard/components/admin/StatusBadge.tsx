const PRESETS: Record<string, { bg: string; color: string }> = {
  active:    { bg: '#052E1B', color: '#22C55E' },
  suspended: { bg: '#2D0D0D', color: '#EF4444' },
  blocked:   { bg: '#2D0D0D', color: '#EF4444' },
  locked:    { bg: '#1C1405', color: '#F59E0B' },
  inactive:  { bg: '#1A2437', color: '#475569' },
  disabled:  { bg: '#1A2437', color: '#475569' },
  pending:   { bg: '#0A2035', color: '#5BB6DE' },
  sending:   { bg: '#1C1405', color: '#F59E0B' },
  completed: { bg: '#052E1B', color: '#22C55E' },
  failed:    { bg: '#2D0D0D', color: '#EF4444' },
  partial:   { bg: '#1C1405', color: '#F59E0B' },
  owner:     { bg: '#1A0D2E', color: '#A78BFA' },
  admin:     { bg: '#0A2035', color: '#5BB6DE' },
  member:    { bg: '#1A2437', color: '#94A3B8' },
  archived:  { bg: '#1A2437', color: '#475569' },
};

type Props = {
  status: string;
  label?: string;
};

export default function StatusBadge({ status, label }: Props) {
  const p = PRESETS[status.toLowerCase()] ?? { bg: '#1A2437', color: '#94A3B8' };
  return (
    <span
      className="inline-block text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: p.bg, color: p.color }}
    >
      {label ?? status.toUpperCase()}
    </span>
  );
}
