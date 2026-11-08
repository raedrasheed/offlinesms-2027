'use client';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { formatDashboardNumber, type DashboardDay, type DashboardStatus } from '@/lib/dashboardOverview';

const tick = { fill: 'var(--c-text-2)', fontSize: 10 };
const tooltip = { background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 8, color: 'var(--c-text)', fontSize: 12 };

export function TrendChart({ data, kind }: { data: DashboardDay[]; kind: 'batches' | 'points' }) {
  const missing = data.some(d => d.value === null);
  if (!missing && data.every(d => d.value === 0)) return <p className="h-40 grid place-items-center text-sm" style={{ color: 'var(--c-text-2)' }}>No {kind === 'points' ? 'settled SMS charges' : 'SMS batches'} in this period.</p>;
  return <>
    {missing && <p role="status" className="text-xs text-amber-600">Some days are unavailable. Gaps are not zero.</p>}
    <div className="h-44 min-w-0" aria-label={kind === 'points' ? 'Daily SMS points spent' : 'Daily SMS batches'}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'points' ? <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={42} allowDecimals={false} />
          <Tooltip contentStyle={tooltip} cursor={{ fill: 'var(--c-nav-active-bg)' }} formatter={v => [formatDashboardNumber(Number(v)), 'Points']} />
          <Bar dataKey="value" fill="#1F7BA8" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart> : <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={tick} axisLine={false} tickLine={false} />
          <YAxis tick={tick} axisLine={false} tickLine={false} width={42} allowDecimals={false} />
          <Tooltip contentStyle={tooltip} formatter={v => [formatDashboardNumber(Number(v)), 'Batches']} />
          <Area type="linear" dataKey="value" stroke="#1F7BA8" fill="#1F7BA8" fillOpacity={0.14} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
        </AreaChart>}
      </ResponsiveContainer>
    </div>
    <details className="mt-2 text-xs" style={{ color: 'var(--c-text-2)' }}>
      <summary className="cursor-pointer">View daily values</summary>
      <table className="w-full mt-2"><caption className="sr-only">Daily values in UTC</caption><thead><tr><th className="text-left">Date (UTC)</th><th className="text-right">{kind === 'points' ? 'Points' : 'Batches'}</th></tr></thead>
        <tbody>{data.map(d => <tr key={d.date}><td>{d.date}</td><td className="text-right">{formatDashboardNumber(d.value)}</td></tr>)}</tbody>
      </table>
    </details>
  </>;
}

export function BatchStatusChart({ data }: { data: DashboardStatus[] }) {
  if (data.some(d => d.value === null)) return <p className="h-40 grid place-items-center text-sm" style={{ color: 'var(--c-text-2)' }}>Batch status data is unavailable.</p>;
  const total = data.reduce((n, d) => n + d.value!, 0);
  if (!total) return <p className="h-40 grid place-items-center text-sm" style={{ color: 'var(--c-text-2)' }}>No SMS batches in this period.</p>;
  return <div className="flex flex-wrap items-center gap-4 min-h-44">
    <div className="relative w-32 h-32 shrink-0" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data.filter(d => d.value! > 0)} dataKey="value" innerRadius={42} outerRadius={60} strokeWidth={0} isAnimationActive={false}>
        {data.filter(d => d.value! > 0).map(d => <Cell key={d.name} fill={d.color} />)}
      </Pie></PieChart></ResponsiveContainer>
      <div className="absolute inset-0 grid place-content-center text-center pointer-events-none"><strong>{formatDashboardNumber(total)}</strong><span className="text-[10px]" style={{ color: 'var(--c-text-2)' }}>batches</span></div>
    </div>
    <ul className="flex-1 space-y-2 text-xs min-w-[150px]">{data.map(d => <li key={d.name} className="flex gap-2 items-center">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.color }} /><span className="flex-1" style={{ color: 'var(--c-text-2)' }}>{d.name}</span>
      <span className="font-semibold">{formatDashboardNumber(d.value)} <span className="font-normal" style={{ color: 'var(--c-text-2)' }}>({((d.value! / total) * 100).toFixed(1)}%)</span></span>
    </li>)}</ul>
  </div>;
}

