type Props = {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export default function DetailCard({ title, subtitle, actions, children }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-ink-100 shadow-sh1 overflow-hidden">
      <div className="flex items-start justify-between px-5 py-4 border-b border-ink-100">
        <div>
          <h2 className="text-sm font-extrabold tracking-tight text-ink-900">{title}</h2>
          {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
        </div>
        {actions && <div className="flex gap-2 shrink-0 ml-4">{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}
