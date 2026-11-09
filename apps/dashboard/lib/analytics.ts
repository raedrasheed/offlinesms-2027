// Shared serializable, aggregate-only reporting contract. No user identifiers.
export const ANALYTICS_RANGES = ['7d', '30d', '90d'] as const;
export type AnalyticsRange = typeof ANALYTICS_RANGES[number];
export const PRESENCE_WINDOW_MS = 45_000; // conversations.ts ONLINE_WINDOW_MS
export const LIVE_REFRESH_MS = 5_000;
export type Metric = { key: string; label: string; value: number | null; note: string; unit?: string };
export type TrendPoint = { date: string; label: string; value: number | null };
export type Breakdown = { name: string; value: number | null; color: string };
export type AnalyticsSection = {
  key: string; title: string; note: string; metrics: Metric[];
  trend?: { title: string; unit: string; points: TrendPoint[] };
  breakdown?: { title: string; rows: Breakdown[] };
};
export type CountryStat = { iso: string; name: string; registered: number; active24h: number; online: number | null };
export type Geography = {
  registeredAt: string; presenceAt: string; total: number; unknown: number;
  onlineUnknown: number | null; countries: CountryStat[];
};
export type AnalyticsLive = {
  updatedAt: string; online: number | null; active24h: number | null;
  active7d: number | null; active30d: number | null; presenceCoverage: number | null;
  relayOnline: number | null; relayQueued: number | null; relayInFlight: number | null;
  showUsers: boolean; showRelay: boolean; geography: Geography | null;
  issues: string[];
};
export type AnalyticsReport = {
  range: AnalyticsRange; scope: string; updatedAt: string; sections: AnalyticsSection[];
  issues: string[]; limitations: string[];
};
export type AnalyticsPayload = { report: AnalyticsReport; live: AnalyticsLive };
export function parseAnalyticsRange(raw: unknown): AnalyticsRange {
  return ANALYTICS_RANGES.includes(raw as AnalyticsRange) ? raw as AnalyticsRange : '7d';
}
export function analyticsBuckets(range: AnalyticsRange, now: Date) {
  const days = Number(range.slice(0, -1));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = today - (days - 1) * 86_400_000;
  const step = range === '90d' ? 7 : 1;
  return Array.from({ length: Math.ceil(days / step) }, (_, i) => {
    const a = new Date(start + i * step * 86_400_000);
    const b = new Date(Math.min(start + (i + 1) * step * 86_400_000, now.getTime()));
    return { start: a, end: b, date: a.toISOString().slice(0, 10),
      label: a.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
  });
}
export function analyticsNumber(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
export function finiteAggregate(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('Invalid aggregate');
  return n;
}

// Request coalescing, bounded memory and explicit expiry. Rejections are never
// reused. DB/role/org/range separation is the caller's responsibility.
export class AnalyticsCache<T> {
  private entries = new Map<string, { expires: number; promise: Promise<T> }>();
  constructor(private ttl: number, private max = 32) {}
  get(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
    for (const [k, v] of this.entries) if (v.expires <= now) this.entries.delete(k);
    const hit = this.entries.get(key);
    if (hit) return hit.promise;
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
    const entry = { expires: now + this.ttl, promise: Promise.resolve().then(load) };
    this.entries.set(key, entry);
    void entry.promise.catch(() => { if (this.entries.get(key) === entry) this.entries.delete(key); });
    return entry.promise;
  }
  delete(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
}
