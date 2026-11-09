'use client';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analyticsNumber as fmt, type TrendPoint } from '../../../lib/analytics';
export function AnalyticsTrend({ points, unit, color = '#1f7ba8' }: { points: TrendPoint[]; unit: string; color?: string }) {
  return <>
    {points.some(p => p.value === null) && <p className="text-xs text-amber-600 mb-2">Unavailable intervals appear as gaps, not zero.</p>}
    <div className="h-52 min-w-0" role="img" aria-label={`${unit} by interval; exact values in the table below`}>
      <ResponsiveContainer width="100%" height="100%"><AreaChart data={points} margin={{ top: 8, right: 10, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--c-border)" strokeDasharray="3 5" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--c-text-2)' }} tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis width={48} allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--c-text-2)' }} tickLine={false} axisLine={false} tickFormatter={n => n >= 1_000_000 ? `${n / 1_000_000}m` : n >= 1_000 ? `${n / 1_000}k` : String(n)} />
        <Tooltip contentStyle={{ background: 'var(--c-card)', border: '1px solid var(--c-border)', borderRadius: 10, color: 'var(--c-text)' }} formatter={v => [fmt(Number(v)), unit]} />
        <Area dataKey="value" stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2.5} type="linear" connectNulls={false} isAnimationActive={false} />
      </AreaChart></ResponsiveContainer>
    </div>
    <details className="text-xs analytics-muted mt-2"><summary className="cursor-pointer">View values</summary><div className="max-h-48 overflow-auto mt-2"><table className="w-full"><thead><tr><th className="text-left">Date / time (UTC)</th><th className="text-right">{unit}</th></tr></thead><tbody>{points.map(p => <tr key={p.date}><td>{p.date}</td><td className="text-right tabular-nums">{fmt(p.value)}</td></tr>)}</tbody></table></div></details>
  </>;
}
