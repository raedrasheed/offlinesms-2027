'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Download, RefreshCw, Users, Activity, Radio, Clock3 } from 'lucide-react';
import { analyticsNumber as fmt, type AnalyticsRange, type AnalyticsReport, type AnalyticsLive } from '../../../lib/analytics';
import { useAnalytics } from './useAnalytics';
import './analytics.css';

const CountryMap = dynamic(() => import('./CountryMap'), { ssr: false, loading: () => <div className="analytics-card p-8 analytics-muted">Loading country map…</div> });
const AnalyticsTrend = dynamic(() => import('./AnalyticsCharts').then(m => m.AnalyticsTrend), { ssr: false, loading: () => <div className="h-52 animate-pulse rounded-xl" style={{ background: 'var(--c-bg)' }} /> });
const stamp = (date: string) => `${new Date(date).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`;
const csvCell = (value: unknown) => { let s = value == null ? '' : String(value); if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`; return `"${s.replaceAll('"', '""')}"`; };
export function analyticsCsv(report: AnalyticsReport, live: AnalyticsLive | null) {
  const rows: unknown[][] = [['Scope', 'Section', 'Metric', 'Date / source note', 'Value', 'Snapshot UTC'],
    [report.scope, 'Metadata', 'Range', report.range, '', report.updatedAt]];
  for (const s of report.sections) {
    for (const m of s.metrics) rows.push([report.scope, s.title, m.label, m.note, m.value, report.updatedAt]);
    for (const p of s.trend?.points ?? []) rows.push([report.scope, s.title, s.trend!.title, p.date, p.value, report.updatedAt]);
    for (const b of s.breakdown?.rows ?? []) rows.push([report.scope, s.title, s.breakdown!.title, b.name, b.value, report.updatedAt]);
  }
  if (live?.showUsers) {
    for (const [key, label] of [['online', 'Active now'], ['active24h', 'Active 24h'], ['active7d', 'Active 7d'], ['active30d', 'Active 30d']] as const)
      rows.push([report.scope, 'Presence', label, 'App-reported last-seen activity', live[key], live.updatedAt]);
  }
  for (const c of live?.geography?.countries ?? []) for (const [key, label] of [['registered', 'Registered'], ['active24h', 'Active 24h'], ['online', 'Active now']] as const)
    rows.push([report.scope, 'Phone-number country (not GPS)', `${c.name} (${c.iso})`, label, c[key], key === 'online' ? live!.geography!.presenceAt : live!.geography!.registeredAt]);
  if (live?.geography) rows.push([report.scope, 'Phone-number country (not GPS)', 'Unknown country', 'Registered', live.geography.unknown, live.geography.registeredAt]);
  for (const note of report.limitations) rows.push([report.scope, 'Definitions', note]);
  for (const issue of [...report.issues, ...(live?.issues ?? [])]) rows.push([report.scope, 'Unavailable', issue]);
  return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
export default function AnalyticsConsole({ initialRange }: { initialRange: AnalyticsRange }) {
  const [range, setRange] = useState(initialRange);
  const state = useAnalytics(range);
  const { report, live, samples } = state;
  const allIssues = [...new Set([...(report?.issues ?? []), ...(live?.issues ?? [])])];
  const changeRange = (value: AnalyticsRange) => { setRange(value); const url = new URL(window.location.href); url.searchParams.set('range', value); window.history.replaceState(null, '', url); };
  const exportCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([analyticsCsv(report, live)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `OfflineSMS-analytics-${range}-${report.updatedAt.slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="analytics-console p-4 md:p-6 space-y-5 max-w-[1800px] mx-auto">
    <header className="flex flex-wrap justify-between items-start gap-4"><div><div className="flex items-center gap-2 text-[10px] uppercase tracking-widest analytics-muted"><Activity size={12} /> OfflineSMS intelligence · {report?.scope ?? 'Authorized scope'}</div>
      <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight mt-1">Live analytics</h1><p className="text-xs analytics-muted mt-2">Users, conversations, media and delivery — measured from your platform data.</p></div>
      <div className="flex flex-wrap gap-2 items-center"><div className="flex rounded-xl p-1 gap-1" style={{ background: 'var(--c-card)', border: '1px solid var(--c-border)' }}>{(['7d', '30d', '90d'] as const).map(r => <button key={r} className={`analytics-chip ${r === range ? 'analytics-chip-active' : ''}`} aria-pressed={r === range} onClick={() => changeRange(r)}>{r.slice(0, -1)} days</button>)}</div>
        <button onClick={state.refresh} disabled={state.blocked || state.paused} className="analytics-action" aria-label="Refresh analytics"><RefreshCw size={14} /></button>
        <button onClick={exportCsv} disabled={!report || state.blocked} className="analytics-action"><Download size={14} /> Export CSV</button></div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] analytics-muted"><span className="flex gap-2 items-center"><span className={`h-2 w-2 rounded-full ${state.blocked || state.liveError ? 'bg-amber-500' : state.paused ? 'bg-slate-400' : live ? 'bg-emerald-500' : 'bg-slate-400'}`} />{state.blocked ? 'Access stopped' : state.paused ? 'Updates paused while hidden or offline' : state.liveError ? 'Live update interrupted' : live ? 'Auto-refresh: presence 5s · reports 60s · country directory 5m' : 'Connecting to analytics…'}</span><span>Presence: {live ? stamp(live.updatedAt) : '—'} · Reports: {report ? stamp(report.updatedAt) : '—'}</span></div>
    {(state.error || state.liveError) && <div role="alert" className="analytics-alert">{state.error}{state.error && state.liveError ? ' ' : ''}{state.liveError}{state.blocked && <a href="/login?next=/admin/reports" className="underline ml-2">Sign in</a>}</div>}
    {allIssues.length > 0 && <details className="analytics-alert text-xs"><summary className="cursor-pointer">{allIssues.length} data source(s) unavailable. Missing values are shown as —.</summary><p className="mt-2">{allIssues.join(' · ')}. Check the server logs and Firestore index deployment.</p></details>}
    {live?.showUsers && <>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {[{ title: 'Active now', value: live.online, note: 'Online flag + heartbeat within 45 seconds', icon: Radio, main: true },
          { title: 'Active in 24 hours', value: live.active24h, note: 'Unique accounts · last-seen window', icon: Activity },
          { title: 'Active in 7 days', value: live.active7d, note: 'Unique accounts · rolling 7 days', icon: Users },
          { title: 'Active in 30 days', value: live.active30d, note: 'Unique accounts · rolling 30 days', icon: Clock3 }].map(c => <div key={c.title} className={`analytics-live-card ${c.main ? 'analytics-live-primary' : ''}`}><div className="flex justify-between items-center text-xs"><span>{c.title}</span><c.icon size={18} opacity={0.7} /></div><strong className="block text-4xl font-extrabold tabular-nums mt-4">{fmt(c.value)}</strong><p className="text-[10px] mt-2 opacity-75">{c.note}</p></div>)}
      </div>
      <div className="analytics-card p-5"><div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-bold">Users active now</h2><p className="text-xs analytics-muted mt-1">Live samples from this open console · gaps indicate paused or unavailable data · not historical session counts</p></div><span className="text-xs analytics-muted">Presence recorded for {fmt(live.presenceCoverage)} accounts</span></div>
        {samples.length > 1 ? <AnalyticsTrend points={samples} unit="Active users" color="#10b981" /> : <p className="text-sm analytics-muted h-28 flex items-center">Collecting live samples…</p>}
      </div>
    </>}
    {live?.showRelay && <div className="analytics-card px-5 py-4 flex flex-wrap gap-6 items-center text-xs"><strong className="flex gap-2 items-center"><Radio size={16} />Relay live status</strong><span>Online devices <b className="ml-2 tabular-nums">{fmt(live.relayOnline)}</b></span><span>Queued jobs <b className="ml-2 tabular-nums">{fmt(live.relayQueued)}</b></span><span>In flight <b className="ml-2 tabular-nums">{fmt(live.relayInFlight)}</b></span><span className="analytics-muted">90-second heartbeat window</span></div>}
    {live?.geography && <CountryMap data={live.geography} />}
    {state.loading && !report && <div role="status" className="analytics-card p-8 text-center analytics-muted">Loading aggregate reports…</div>}
    {report && <>
      <nav aria-label="Analytics sections" className="flex flex-wrap gap-2">{report.sections.map(s => <a key={s.key} href={`#analytics-${s.key}`} className="analytics-chip analytics-section-link">{s.title}</a>)}</nav>
      <div className="grid xl:grid-cols-2 gap-5">{report.sections.map(s => <section key={s.key} id={`analytics-${s.key}`} className={`analytics-card p-5 scroll-mt-5 min-w-0 ${s.metrics.length > 4 ? 'xl:col-span-2' : ''}`} aria-labelledby={`analytics-title-${s.key}`}>
        <h2 id={`analytics-title-${s.key}`} className="text-base font-bold">{s.title}</h2><p className="text-[11px] analytics-muted mt-1 leading-relaxed">{s.note}</p>
        <div className={`grid grid-cols-2 ${s.metrics.length > 4 ? 'lg:grid-cols-3 xl:grid-cols-6' : ''} gap-3 my-5`}>{s.metrics.map(m => <div key={m.key} className="analytics-stat"><div className="text-[10px] uppercase tracking-wide analytics-muted">{m.label}</div><strong className="block text-2xl font-extrabold mt-1 tabular-nums">{fmt(m.value)}</strong><p className="text-[10px] analytics-muted mt-1 leading-relaxed">{m.note}</p></div>)}</div>
        <div className={s.trend && s.breakdown ? 'grid lg:grid-cols-2 gap-6' : ''}>
          {s.trend && <div className="min-w-0"><h3 className="text-xs font-semibold mb-3">{s.trend.title} · {range === '90d' ? '7-day buckets, final bucket partial' : 'daily'} · UTC</h3><AnalyticsTrend points={s.trend.points} unit={s.trend.unit} /></div>}
          {s.breakdown && <div className="min-w-0"><h3 className="text-xs font-semibold mb-3">{s.breakdown.title}</h3>{s.breakdown.rows.some(b => b.value === null) && <p className="text-xs text-amber-600 mb-2">Some status counts are unavailable.</p>}
            <div className="space-y-3">{s.breakdown.rows.map(b => { const total = s.breakdown!.rows.reduce((n, r) => n + (r.value ?? 0), 0); const complete = s.breakdown!.rows.every(r => r.value !== null); return <div key={b.name}><div className="flex justify-between gap-2 text-[11px]"><span>{b.name}</span><span className="tabular-nums font-semibold">{fmt(b.value)} {complete && total > 0 && <span className="analytics-muted font-normal">({((b.value! / total) * 100).toFixed(1)}%)</span>}</span></div><div className="h-1.5 rounded-full mt-1 overflow-hidden" style={{ background: 'var(--c-bg)' }}><div className="h-full rounded-full" style={{ background: b.color, width: complete && total > 0 ? `${b.value! / total * 100}%` : '0%' }} /></div></div>; })}</div>
          </div>}
        </div>
      </section>)}</div>
      <details className="analytics-card p-5 text-xs analytics-muted"><summary className="cursor-pointer font-bold analytics-text">Metric definitions, coverage & sources</summary><ul className="list-disc pl-5 mt-3 space-y-2">{report.limitations.map(note => <li key={note}>{note}</li>)}<li>Missing phone numbers, ambiguous country codes and unsupported number formats stay in “Unknown”. The country directory and its 24-hour activity values update every 5 minutes.</li><li>Empty queries return zero; failed queries return —. Financial values are points, not combined currency revenue.</li><li>Statistics are scoped to verified administrator permissions. Private message bodies, phone numbers and user names are never included in this report or its CSV.</li></ul><p className="mt-4">Sources: <a className="underline" href="https://firebase.google.com/docs/firestore/query-data/aggregation-queries" target="_blank" rel="noreferrer">Firestore aggregates</a> · <a className="underline" href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer">Natural Earth map data</a></p></details>
    </>}
  </div>;
}
