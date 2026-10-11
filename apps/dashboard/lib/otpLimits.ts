// Verification-SMS send limits and relay device caps, as the dashboard edits them.
//
// The functions own the limits: they read smsConfig/otp.{signin,link}.limits and
// smsConfig/otp.shared, and clamp every value into the same bounds as below
// (functions/src/phoneAuth/config.ts, phoneLink/config.ts, verification/policy.ts).
// The dashboard offers the budgets an operator tunes while rolling out, and refuses
// anything outside those bounds instead of letting the functions clamp it silently.
// __tests__/otpLimits.test.ts keeps these tables equal to the functions' own.
//
// Relay caps (relayDevices/{id}.caps) have no server-side bounds: the claim reads
// them as they are (functions/src/sms/relayLogic.ts relayCapacityCheck), so a
// non-number would break it. Only whole numbers within RELAY_CAP_BOUNDS are written.

export interface OtpLimitField {
  /** Firestore field path inside smsConfig/otp. */
  path: string;
  group: 'signin' | 'link' | 'shared';
  name: string;
  min: number;
  max: number;
  /** The functions' default when the field is absent. */
  def: number;
}

export const OTP_LIMIT_FIELDS: readonly OtpLimitField[] = [
  { path: 'signin.limits.globalPerHour', group: 'signin', name: 'globalPerHour', min: 0, max: 2000, def: 100 },
  { path: 'signin.limits.globalPerDay', group: 'signin', name: 'globalPerDay', min: 0, max: 10000, def: 500 },
  { path: 'signin.limits.destinationPerHour', group: 'signin', name: 'destinationPerHour', min: 0, max: 10, def: 3 },
  { path: 'signin.limits.destinationPerDay', group: 'signin', name: 'destinationPerDay', min: 0, max: 20, def: 5 },
  { path: 'signin.limits.sourcePerHour', group: 'signin', name: 'sourcePerHour', min: 0, max: 500, def: 20 },
  { path: 'signin.limits.sourcePerDay', group: 'signin', name: 'sourcePerDay', min: 0, max: 2000, def: 60 },
  { path: 'signin.limits.installPerDay', group: 'signin', name: 'installPerDay', min: 0, max: 50, def: 5 },
  { path: 'link.limits.globalPerHour', group: 'link', name: 'globalPerHour', min: 0, max: 2000, def: 100 },
  { path: 'link.limits.globalPerDay', group: 'link', name: 'globalPerDay', min: 0, max: 10000, def: 500 },
  { path: 'link.limits.accountPerHour', group: 'link', name: 'accountPerHour', min: 0, max: 10, def: 3 },
  { path: 'link.limits.accountPerDay', group: 'link', name: 'accountPerDay', min: 0, max: 20, def: 5 },
  { path: 'link.limits.destinationPerHour', group: 'link', name: 'destinationPerHour', min: 0, max: 10, def: 3 },
  { path: 'link.limits.destinationPerDay', group: 'link', name: 'destinationPerDay', min: 0, max: 20, def: 5 },
  { path: 'shared.perHour', group: 'shared', name: 'perHour', min: 0, max: 3000, def: 150 },
  { path: 'shared.perDay', group: 'shared', name: 'perDay', min: 0, max: 15000, def: 700 },
];

/** A value per field path: a whole number, or null for "use the default". */
export type OtpLimitValues = Record<string, number | null>;

function getPath(doc: Record<string, unknown> | null | undefined, path: string): unknown {
  let cur: unknown = doc;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** The stored value of each field (null when absent or not a number). */
export function readOtpLimits(doc: Record<string, unknown> | null | undefined): OtpLimitValues {
  const out: OtpLimitValues = {};
  for (const f of OTP_LIMIT_FIELDS) {
    const v = getPath(doc, f.path);
    out[f.path] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}

/**
 * Validate an edit. Only known field paths are accepted; each value must be a
 * whole number within the field's bounds, or null to remove the override.
 */
export function parseOtpLimits(input: unknown): { values: OtpLimitValues } | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid limits.' };
  const values: OtpLimitValues = {};
  for (const [path, raw] of Object.entries(input as Record<string, unknown>)) {
    const f = OTP_LIMIT_FIELDS.find(x => x.path === path);
    if (!f) return { error: `Unknown limit: ${path}` };
    if (raw === null) { values[path] = null; continue; }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < f.min || raw > f.max) {
      return { error: `${f.group} ${f.name} must be a whole number from ${f.min} to ${f.max}.` };
    }
    values[path] = raw;
  }
  if (Object.keys(values).length === 0) return { error: 'Nothing to change.' };
  return { values };
}

export interface RelayCaps { maxPerMinute: number; maxPerHour: number; maxPerDay: number }

export const RELAY_CAP_DEFAULTS: RelayCaps = { maxPerMinute: 6, maxPerHour: 100, maxPerDay: 500 };
export const RELAY_CAP_BOUNDS: Record<keyof RelayCaps, [number, number]> = {
  maxPerMinute: [0, 15],
  maxPerHour: [0, 1000],
  maxPerDay: [0, 10000],
};

/** The caps a device actually runs with: stored values over the functions' defaults. */
export function effectiveRelayCaps(stored: unknown): RelayCaps {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const pick = (k: keyof RelayCaps) => (typeof s[k] === 'number' ? (s[k] as number) : RELAY_CAP_DEFAULTS[k]);
  return { maxPerMinute: pick('maxPerMinute'), maxPerHour: pick('maxPerHour'), maxPerDay: pick('maxPerDay') };
}

/** Validate all three caps: whole numbers within bounds, minute ≤ hour ≤ day. */
export function parseRelayCaps(input: unknown): { caps: RelayCaps } | { error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Invalid caps.' };
  const i = input as Record<string, unknown>;
  const caps = {} as RelayCaps;
  for (const k of Object.keys(RELAY_CAP_BOUNDS) as (keyof RelayCaps)[]) {
    const v = i[k];
    const [min, max] = RELAY_CAP_BOUNDS[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      return { error: `${k} must be a whole number from ${min} to ${max}.` };
    }
    caps[k] = v;
  }
  if (caps.maxPerMinute > caps.maxPerHour || caps.maxPerHour > caps.maxPerDay) {
    return { error: 'Caps must not decrease: per minute ≤ per hour ≤ per day.' };
  }
  return { caps };
}
