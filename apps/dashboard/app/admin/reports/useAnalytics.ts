'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LIVE_REFRESH_MS, type AnalyticsLive, type AnalyticsRange, type AnalyticsReport, type TrendPoint } from '../../../lib/analytics';

export function appendPresenceSample(samples: TrendPoint[], live: AnalyticsLive): TrendPoint[] {
  if (!live.showUsers || samples.at(-1)?.date === live.updatedAt) return samples;
  const next = [...samples];
  const previous = samples.at(-1);
  if (previous && Date.parse(live.updatedAt) - Date.parse(previous.date) > LIVE_REFRESH_MS * 3) {
    const gap = new Date(Date.parse(previous.date) + LIVE_REFRESH_MS).toISOString();
    next.push({ date: gap, label: new Date(gap).toLocaleTimeString('en-GB', { timeZone: 'UTC' }), value: null });
  }
  next.push({ date: live.updatedAt, label: new Date(live.updatedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' }), value: live.online });
  return next.slice(-120);
}

export function useAnalytics(range: AnalyticsRange) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [live, setLive] = useState<AnalyticsLive | null>(null);
  const [samples, setSamples] = useState<TrendPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let alive = true, generation = 0, denied = false;
    const running = new Map<string, AbortController>();
    const intervals: ReturnType<typeof setInterval>[] = [];
    setReport(null); setError(null); setBlocked(false); setLoading(true);
    const active = () => document.visibilityState !== 'hidden' && navigator.onLine !== false;
    const abort = () => { generation++; for (const c of running.values()) c.abort(); running.clear(); };
    const poll = async (kind: 'live' | 'report') => {
      if (!alive || denied || !active() || running.has(kind)) return;
      const version = generation, controller = new AbortController();
      running.set(kind, controller);
      if (kind === 'report') setLoading(true);
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 25_000);
      try {
        const response = await fetch(`/api/admin/analytics?kind=${kind}&range=${range}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        if (!alive || version !== generation) return;
        if (response.status === 401 || response.status === 403) {
          denied = true; abort(); setBlocked(true); setReport(null); setLive(null); setSamples([]); setLoading(false);
          setError(response.status === 401 ? 'Your session expired. Sign in again to view analytics.' : 'Your permissions do not allow analytics.');
          return;
        }
        if (!response.ok) throw new Error('Request failed');
        const data = await response.json();
        if (!alive || version !== generation) return;
        if (kind === 'report') {
          if (!data.report || data.report.range !== range || !Array.isArray(data.report.sections)) throw new Error('Invalid report');
          setReport(data.report); setError(null);
        } else {
          if (!data.live || typeof data.live.updatedAt !== 'string') throw new Error('Invalid presence');
          setLive(data.live); setSamples(previous => appendPresenceSample(previous, data.live)); setLiveError(null);
        }
      } catch {
        if (alive && version === generation && (timedOut || !controller.signal.aborted)) {
          if (kind === 'report') setError('The latest report could not be loaded. Previously displayed values, if any, have not been refreshed.');
          else { setLiveError('Live activity could not refresh. These values are stale.'); setSamples(previous => previous.length ? [...previous.slice(-119), { date: new Date().toISOString(), label: new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC' }), value: null }] : previous); }
        }
      } finally {
        clearTimeout(timeout);
        if (running.get(kind) === controller) running.delete(kind);
        if (alive && version === generation && kind === 'report') setLoading(false);
      }
    };
    const refresh = () => { if (!denied) { void poll('live'); void poll('report'); } };
    const visibility = () => {
      if (!active()) { abort(); setPaused(true); setLoading(false); }
      else { setPaused(false); refresh(); }
    };
    refreshRef.current = refresh;
    intervals.push(setInterval(() => void poll('live'), LIVE_REFRESH_MS));
    intervals.push(setInterval(() => void poll('report'), 60_000));
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', visibility); window.addEventListener('offline', visibility); window.addEventListener('focus', refresh);
    visibility();
    return () => { alive = false; abort(); intervals.forEach(clearInterval); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('online', visibility); window.removeEventListener('offline', visibility); window.removeEventListener('focus', refresh); };
  }, [range]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return { report, live, samples, error, liveError, blocked, paused, loading, refresh };
}
