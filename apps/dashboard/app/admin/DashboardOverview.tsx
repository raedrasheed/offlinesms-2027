'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Activity, RefreshCw } from 'lucide-react';
import { DASHBOARD_REFRESH_MS, formatDashboardNumber as fmt, type DashboardOverview as Overview } from '../../lib/dashboardOverview';
import { TrendChart, BatchStatusChart } from './DashboardCharts';

const card = { background: 'var(--c-card)', border: '1px solid var(--c-border)' };
function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl p-5 min-w-0" style={card}>
    <h2 className="text-sm font-semibold">{title}</h2>
    {note && <p className="mt-1 mb-4 text-xs" style={{ color: 'var(--c-text-2)' }}>{note}</p>}
    {children}
  </section>;
}

export default function DashboardOverview({ initialData }: { initialData: Overview }) {
  const [data, setData] = useState<Overview | null>(initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [offline, setOffline] = useState(false);
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const blocked = useRef(false);

  const refresh = useCallback(async () => {
    if (active.current || blocked.current || document.visibilityState === 'hidden') return;
    if (!navigator.onLine) { setOffline(true); return; }
    const controller = new AbortController();
    const version = generation.current;
    const current = () => version === generation.current;
    active.current = controller;
    setRefreshing(true);
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch('/api/admin/overview', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        blocked.current = true;
        setData(null); setEnded(true); setError('Your session or access has changed. Sign in again to continue.');
        return;
      }
      if (!response.ok) throw new Error('refresh failed');
      const next: Overview = await response.json();
      if (current()) { setData(next); setError(null); setOffline(false); }
    } catch {
      if (current()) setError('Refresh failed. Showing the last successful snapshot. Retrying automatically.');
    } finally {
      clearTimeout(timeout);
      if (active.current === controller) active.current = null;
      if (current()) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const version = generation.current + 1;
    generation.current = version;
    if (!blocked.current) setData(initialData);
    setRefreshing(false);
    setOffline(!navigator.onLine);
    const timer = setInterval(() => { void refresh(); }, DASHBOARD_REFRESH_MS);
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    const online = () => { setOffline(false); void refresh(); };
    const disconnected = () => setOffline(true);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', online);
    window.addEventListener('offline', disconnected);
    if (Date.now() - Date.parse(initialData.generatedAt) >= DASHBOARD_REFRESH_MS) void refresh();
    return () => {
      generation.current = version + 1;
      clearInterval(timer);
      active.current?.abort(); active.current = null;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', disconnected);
    };
  }, [refresh, initialData]);

  const partial = !!data?.issues.length;
  const updated = data?.generatedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  return <div className="p-4 md:p-7 space-y-5" style={{ color: 'var(--c-text)' }}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs mb-1" style={{ color: 'var(--c-text-2)' }}>Admin / Dashboard</p><h1 className="text-2xl font-extrabold tracking-tight">Overview</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--c-text-2)' }}>{data?.scope ?? 'OfflineSMS'} · Automatic updates every 15 seconds</p>
      </div>
      <button type="button" onClick={() => void refresh()} disabled={refreshing || ended || offline} className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50" style={card}>
        <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />{refreshing ? 'Refreshing…' : 'Refresh now'}
      </button>
    </div>
    <div role="status" className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--c-text-2)' }}>
      <Activity size={14} /><span>{ended ? 'Access ended' : offline ? 'Offline · updates paused' : error ? 'Updates interrupted' : partial ? 'Some data unavailable' : 'Live updates enabled'}</span>
      {updated && <span>· Last snapshot <time dateTime={data!.generatedAt}>{updated}</time></span>}
    </div>
    {(error || offline) && <div role="alert" className="rounded-xl p-4 text-sm" style={{ ...card, borderColor: 'var(--c-warning-border)' }}>
      {offline ? 'You are offline. Showing the last snapshot. Updates resume when the connection returns.' : error}
      {ended && <Link href="/login?next=/admin" className="underline ml-2">Sign in</Link>}
    </div>}
    {partial && <div role="alert" className="rounded-xl p-4 text-sm" style={{ ...card, borderColor: 'var(--c-warning-border)' }}>
      Could not load {data!.issues.join(', ')}. These values are marked unavailable. Retrying automatically.
    </div>}
    {data && <>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-3">
        {data.metrics.map(m => <section key={m.key} className="rounded-2xl p-5" style={card} data-metric={m.key}>
          <h2 className="text-xs font-semibold" style={{ color: 'var(--c-text-2)' }}>{m.label}</h2>
          <p className={`${m.value === null ? 'text-base' : 'text-3xl'} font-bold tabular-nums mt-3`} style={{ color: 'var(--c-text)' }}>{fmt(m.value)}</p>
          <p className="text-[11px] mt-2" style={{ color: 'var(--c-text-2)' }}>{m.note}</p>
        </section>)}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {data.smsTrend && <Panel title="SMS batches over time" note="Last 7 calendar days · UTC"><TrendChart data={data.smsTrend} kind="batches" /></Panel>}
        {data.batchStatuses && <Panel title="SMS batch status" note="Distribution by batch status · 7 calendar days · UTC"><BatchStatusChart data={data.batchStatuses} /></Panel>}
        {data.pointsTrend && <Panel title="SMS points usage" note="Settled charges after refunds · 7 calendar days · UTC"><TrendChart data={data.pointsTrend} kind="points" /></Panel>}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
        {data.smsTrend && <div className="xl:col-span-2 rounded-2xl overflow-hidden" style={card}>
          <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--c-border)' }}><h2 className="text-sm font-semibold">Recent SMS batches</h2></div>
          {data.recentBatches === null ? <p className="p-6 text-sm" style={{ color: 'var(--c-text-2)' }}>Recent batches are unavailable.</p>
            : data.recentBatches.length === 0 ? <p className="p-6 text-sm" style={{ color: 'var(--c-text-2)' }}>No SMS batches yet. Actual batches will appear here after sending.</p>
            : <div className="overflow-x-auto"><table className="w-full text-xs text-left whitespace-nowrap"><caption className="sr-only">The six latest SMS batches, newest first</caption>
              <thead style={{ color: 'var(--c-text-2)' }}><tr>{['Batch', 'Recipients', 'Status', ...(data.pointsTrend ? ['Billed points'] : []), 'Created (UTC)'].map(h => <th key={h} className="px-5 py-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{data.recentBatches.map(b => <tr key={b.id} style={{ borderTop: '1px solid var(--c-border)' }}>
                <td className="px-5 py-3 font-mono" title={b.id}>{b.id.slice(0, 12)}</td><td className="px-5 py-3 tabular-nums">{fmt(b.recipients)}</td>
                <td className="px-5 py-3"><span className="rounded-md px-2 py-1 capitalize" style={{ background: 'var(--c-sidebar-sub)' }}>{b.status}</span></td>
                {data.pointsTrend && <td className="px-5 py-3">{b.billedPoints == null ? 'Pending settlement' : fmt(b.billedPoints)}</td>}
                <td className="px-5 py-3" style={{ color: 'var(--c-text-2)' }}>{b.createdAt ? <time dateTime={b.createdAt}>{b.createdAt.slice(0, 19).replace('T', ' ')}</time> : 'Unavailable'}</td>
              </tr>)}</tbody>
            </table></div>}
        </div>}
        {data.relay && <Panel title="SMS relay activity" note="Current relay queue and device heartbeats">
          <dl className="space-y-4">{[
            ['Queued jobs', data.relay.queued], ['Jobs being sent', data.relay.inFlight], ['Online relay devices', data.relay.online], ['Registered relay devices', data.relay.total],
          ].map(([label, value]) => <div key={String(label)} className="flex items-center justify-between gap-3 text-sm"><dt style={{ color: 'var(--c-text-2)' }}>{label}</dt><dd className="font-bold tabular-nums">{fmt(value as number | null)}</dd></div>)}</dl>
          <p className="text-xs mt-5" style={{ color: 'var(--c-text-2)' }}>Online means an active device reported a heartbeat in the last 90 seconds.</p>
        </Panel>}
      </div>
    </>}
  </div>;
}
