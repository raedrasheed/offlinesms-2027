// Request-source extraction for per-source rate limiting. Pure.
//
// Cloud Functions (2nd gen) sit behind Google's front end, which APPENDS the
// address of the peer that connected to it to X-Forwarded-For. Everything to
// the left of that entry is whatever the client chose to send, so only entries
// counted from the RIGHT are trustworthy. `hopsFromRight` (config
// sourceHopsFromRight, default 1) selects which one; it must be confirmed
// against production request logs before relying on per-source limits (see
// docs/PHONE_LINKING_SECURITY.md). If the chosen hop turns out to be a Google
// address, every caller shares one bucket and the per-source limit degrades
// into a second global limit — more restrictive, never a bypass.
//
// Buckets: IPv4 → the /32 address; IPv6 → the /64 prefix (one subscriber
// usually owns a whole /64, so per-address limits would be trivially evaded).
// No usable address → the shared bucket "unknown".

import { isIP } from 'node:net';

export const UNKNOWN_SOURCE = 'unknown';

function firstHeader(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.join(',');
  return typeof v === 'string' ? v : '';
}

/** Pick the trusted client address (or null). */
export function trustedClientIp(
  xForwardedFor: string | string[] | undefined,
  socketIp: string | undefined | null,
  hopsFromRight = 1,
): string | null {
  const hops = firstHeader(xForwardedFor).split(',').map(s => s.trim()).filter(Boolean);
  if (hops.length > 0) {
    const idx = hops.length - Math.max(1, hopsFromRight);
    const cand = idx >= 0 ? stripPort(hops[idx]) : null;
    return cand && isIP(cand) ? cand : null;
  }
  const s = stripPort(socketIp ?? '');
  return s && isIP(s) ? s : null;
}

function stripPort(v: string): string {
  const t = v.trim();
  if (t.startsWith('[')) return t.slice(1, t.indexOf(']') > 0 ? t.indexOf(']') : undefined);
  // "1.2.3.4:5678" → "1.2.3.4" (only for dotted IPv4; bare IPv6 has many colons)
  const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(t);
  return m ? m[1] : t;
}

function expandIpv6(ip: string): string[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // Embedded IPv4 tail ("::ffff:1.2.3.4") → two hextets.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const p = v4[1].split('.').map(Number);
    s = s.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const parts = [...head, ...Array(fill).fill('0'), ...tail];
  if (parts.length !== 8 || parts.some(h => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return parts.map(h => h.padStart(4, '0'));
}

/** Rate-limit bucket for an address. */
export function sourceBucket(ip: string | null): string {
  if (!ip) return UNKNOWN_SOURCE;
  const fam = isIP(ip);
  if (fam === 4) return `v4:${ip}`;
  if (fam === 6) {
    const parts = expandIpv6(ip);
    if (!parts) return UNKNOWN_SOURCE;
    // IPv4-mapped (::ffff:a.b.c.d) → treat as the IPv4 address.
    if (parts.slice(0, 5).every(p => p === '0000') && parts[5] === 'ffff') {
      const a = parseInt(parts[6], 16), b = parseInt(parts[7], 16);
      return `v4:${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
    }
    return `v6:${parts.slice(0, 4).join(':')}::/64`;
  }
  return UNKNOWN_SOURCE;
}
