const CARD   = '#131B27';
const BORDER = '#1A2437';

type Props = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export default function DetailCard({ title, subtitle, actions, children }: Props) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: `1px solid ${BORDER}` }}>
      <div className="flex items-start justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <h2 className="text-sm font-extrabold tracking-tight" style={{ color: '#E2E8F2' }}>{title}</h2>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: '#64748B' }}>{subtitle}</p>}
        </div>
        {actions && <div className="flex gap-2 shrink-0 ml-4">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
