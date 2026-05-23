const PRESETS: Record<string, { bg: string; color: string }> = {
  active:    { bg: 'var(--c-success-bg)', color: '#22C55E' },
  suspended: { bg: 'var(--c-error-bg)', color: '#EF4444' },
  blocked:   { bg: 'var(--c-error-bg)', color: '#EF4444' },
  locked:    { bg: 'var(--c-warning-bg)', color: '#F59E0B' },
  inactive:  { bg: 'var(--c-border)', color: 'var(--c-text-4)' },
  disabled:  { bg: 'var(--c-border)', color: 'var(--c-text-4)' },
  pending:   { bg: '#0A2035', color: '#5BB6DE' },
  sending:   { bg: 'var(--c-warning-bg)', color: '#F59E0B' },
  completed: { bg: 'var(--c-success-bg)', color: '#22C55E' },
  failed:    { bg: 'var(--c-error-bg)', color: '#EF4444' },
  partial:   { bg: 'var(--c-warning-bg)', color: '#F59E0B' },
  owner:     { bg: '#1A0D2E', color: '#A78BFA' },
  admin:     { bg: '#0A2035', color: '#5BB6DE' },
  member:    { bg: 'var(--c-border)', color: 'var(--c-text-2)' },
  archived:  { bg: 'var(--c-border)', color: 'var(--c-text-4)' },
};

type Props = {
  status: string;
  label?: string;
};

export default function StatusBadge({ status, label }: Props) {
  const p = PRESETS[status.toLowerCase()] ?? { bg: 'var(--c-border)', color: 'var(--c-text-2)' };
  return (
    <span
      className="inline-block text-[10px] font-bold tracking-wide px-2 py-0.5 rounded-full"
      style={{ background: p.bg, color: p.color }}
    >
      {label ?? status.toUpperCase()}
    </span>
  );
}
