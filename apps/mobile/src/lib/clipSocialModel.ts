/** Merge pages by identity without losing newer edits already in memory. */
export function appendUnique<T extends { id: string }>(old: T[], page: T[]): T[] {
  const seen = new Set(old.map(row => row.id));
  return [...old, ...page.filter(row => !seen.has(row.id) && !!seen.add(row.id))];
}

/** One id for a user's pending operation. Keep it after a lost response so a
 * retry can be recognized by the server instead of making a duplicate post. */
export function clipOperationId(): string {
  return `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

export function trimDraftRange(durationMs: number, startSeconds: string, endSeconds: string, maxSeconds: number) {
  const numeric = (value: string) => Number(value.replace(/[٠-٩]/g, n => String(n.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, n => String(n.charCodeAt(0) - 0x06f0)).replace(/[٫,]/g, '.'));
  const start = numeric(startSeconds), end = numeric(endSeconds);
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(maxSeconds) || maxSeconds <= 0 || !startSeconds.trim() || !endSeconds.trim() || !Number.isFinite(start) || !Number.isFinite(end)
      || start < 0 || end <= start || end * 1000 > durationMs + 250 || end - start > maxSeconds + 0.001) return null;
  const trimStartMs = Math.round(start * 1000), trimEndMs = Math.min(durationMs, Math.round(end * 1000));
  return trimEndMs <= trimStartMs || trimEndMs - trimStartMs > maxSeconds * 1000 ? null : { trimStartMs, trimEndMs };
}
