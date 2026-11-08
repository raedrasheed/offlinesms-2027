// Serializable contract shared by the server loader and the live dashboard.
export type DashboardMetric = { key: string; label: string; value: number | null; note: string };
export type DashboardDay = { date: string; label: string; value: number | null };
export type DashboardStatus = { name: string; value: number | null; color: string };
export type DashboardBatch = {
  id: string; status: string; recipients: number | null; billedPoints?: number | null; createdAt: string | null;
};
export type DashboardOverview = {
  generatedAt: string;
  scope: string;
  metrics: DashboardMetric[];
  smsTrend: DashboardDay[] | null;
  batchStatuses: DashboardStatus[] | null;
  pointsTrend: DashboardDay[] | null;
  recentBatches: DashboardBatch[] | null;
  relay: { queued: number | null; inFlight: number | null; online: number | null; total: number | null } | null;
  issues: string[];
};

export const DASHBOARD_REFRESH_MS = 15_000;

/** Seven UTC calendar days including today. End today at the snapshot time. */
export function dashboardDays(now: Date) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: 7 }, (_, i) => {
    const start = new Date(today - (6 - i) * 86_400_000);
    const end = new Date(Math.min(start.getTime() + 86_400_000, now.getTime()));
    return { start, end, date: start.toISOString().slice(0, 10), label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) };
  });
}

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatDashboardNumber(value: number | null): string {
  return value === null ? 'Unavailable' : value.toLocaleString('en-US');
}
