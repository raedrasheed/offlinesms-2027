// In-memory rate limiter for sensitive admin routes.
//
// Uses a Map keyed by "<uid>:<route-key>" → array of hit timestamps.
// State is ephemeral (per process/serverless invocation), which is acceptable
// for low-traffic admin routes where the primary goal is accidental abuse
// prevention rather than adversarial bypass resistance.
//
// Stale entries are pruned on every check to avoid unbounded memory growth.

export type RateLimitOptions = {
  maxRequests: number;
  windowMs:    number;
};

type HitRecord = number[]; // Unix epoch ms timestamps

const store = new Map<string, HitRecord>();

export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): { ok: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const windowStart = now - opts.windowMs;

  // Prune all entries older than 2× window on each access.
  for (const [k, hits] of store.entries()) {
    const pruned = hits.filter(t => t > now - opts.windowMs * 2);
    if (pruned.length === 0) store.delete(k);
    else store.set(k, pruned);
  }

  const hits = (store.get(key) ?? []).filter(t => t > windowStart);

  if (hits.length >= opts.maxRequests) {
    const oldest   = hits[0];
    const resetAt  = oldest + opts.windowMs;
    return { ok: false, retryAfterMs: resetAt - now };
  }

  hits.push(now);
  store.set(key, hits);
  return { ok: true };
}

export function rateLimitResponse(retryAfterMs: number): Response {
  const secs = Math.ceil(retryAfterMs / 1000);
  return new Response(
    JSON.stringify({ error: `Rate limit exceeded. Try again in ${secs}s.` }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
}

// Pre-configured limit sets used across routes.
export const LIMITS = {
  search:      { maxRequests: 60,  windowMs: 60_000       } satisfies RateLimitOptions,
  export:      { maxRequests: 10,  windowMs: 3_600_000    } satisfies RateLimitOptions,
  auditExport: { maxRequests: 5,   windowMs: 3_600_000    } satisfies RateLimitOptions,
};
