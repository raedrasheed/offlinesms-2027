// Verification-SMS policy — the ONE runtime switchboard for every OTP the relay
// can send (public phone sign-in/sign-up and account phone linking).
//
// Stored in the existing admin-only doc smsConfig/otp, which already held the
// sender organization (businessId) and the SMS Retriever hash:
//
//   {
//     businessId:     '<relay org>' | null,   // who sends verification SMS
//     androidAppHash: '<11 chars>'?,
//     enabled:        true,                    // master switch (missing ⇒ off)
//     emergencyStop:  false,                   // must be EXPLICITLY false to send
//     policyVersion:  <int>,                   // bumped on every sender/state change
//     signin: { enabled, limits?, pow?, attestation? },
//     link:   { enabled, limits? },
//     shared: { perHour?, perDay? },           // budget across both purposes
//     sourceHopsFromRight?: 1..3,
//   }
//
// The production doc today carries only businessId (+ hash), so under this code
// it resolves to OFF — the current suspension is preserved until someone
// deliberately writes enabled/emergencyStop/purpose flags AND the deploy-time
// env gate for that purpose is set. Missing doc ⇒ off; unreadable doc ⇒ callers
// fail closed.
//
// Every verification job records businessId + policyVersion at admission; the
// relay will only hand out / authorize a job whose values still match the
// current policy, so changing the sender, stopping, or toggling a purpose
// strands old queued work instead of draining it later.

import type { Firestore } from 'firebase-admin/firestore';

export const OTP_POLICY_DOC = { collection: 'smsConfig', doc: 'otp' } as const;

export type VerificationPurpose = 'signin' | 'link';

/** Deploy-time gates. Only the exact string "true" enables a purpose. */
export const PURPOSE_ENV: Record<VerificationPurpose, string> = {
  signin: 'PHONE_AUTH_ENABLED',
  link: 'PHONE_LINK_ENABLED',
};

export function purposeEnvEnabled(p: VerificationPurpose, env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PURPOSE_ENV[p]] === 'true';
}

export interface SharedPolicy {
  /** Doc exists and `enabled === true`. */
  masterEnabled: boolean;
  /** Missing doc, or anything other than an explicit `false`. */
  emergencyStop: boolean;
  businessId: string | null;
  androidAppHash: string | null;
  policyVersion: number;
  sourceHopsFromRight: number;
  /** Budget shared by every verification purpose. */
  sharedPerHour: number;
  sharedPerDay: number;
}

export const SHARED_DEFAULTS = { perHour: 150, perDay: 700 };
export const SHARED_BOUNDS = { perHour: [0, 3000] as [number, number], perDay: [0, 15000] as [number, number] };

export function clampInt(v: unknown, [lo, hi]: [number, number], fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(v)));
}

/** Clamp a set of numeric overrides into [lo, hi] bounds, falling back to defaults. */
export function resolveBounded<T extends { [K in keyof T]: number }>(
  defaults: T, bounds: { [K in keyof T]: [number, number] }, overrides: unknown,
): T {
  const o = (overrides && typeof overrides === 'object' ? overrides : {}) as Record<string, unknown>;
  const out = { ...defaults };
  for (const k of Object.keys(defaults) as Array<keyof T>) {
    out[k] = clampInt(o[k as string], bounds[k], defaults[k]) as T[keyof T];
  }
  return out;
}

/** Pure: the policy fields shared by every purpose. */
export function resolveShared(doc: Record<string, unknown> | null): SharedPolicy {
  const d = doc ?? {};
  const shared = (d.shared && typeof d.shared === 'object' ? d.shared : {}) as Record<string, unknown>;
  const businessId = typeof d.businessId === 'string' && d.businessId.trim() ? d.businessId.trim() : null;
  const hash = typeof d.androidAppHash === 'string' && /^[A-Za-z0-9+/]{11}$/.test(d.androidAppHash.trim())
    ? d.androidAppHash.trim() : null;
  return {
    masterEnabled: doc !== null && d.enabled === true,
    emergencyStop: doc === null || d.emergencyStop !== false,
    businessId,
    androidAppHash: hash,
    policyVersion: clampInt(d.policyVersion, [0, Number.MAX_SAFE_INTEGER], 0),
    sourceHopsFromRight: clampInt(d.sourceHopsFromRight, [1, 3], 1),
    sharedPerHour: clampInt(shared.perHour, SHARED_BOUNDS.perHour, SHARED_DEFAULTS.perHour),
    sharedPerDay: clampInt(shared.perDay, SHARED_BOUNDS.perDay, SHARED_DEFAULTS.perDay),
  };
}

/** Pure: the purpose sub-object (`signin` / `link`) of the raw doc. */
export function purposeSection(doc: Record<string, unknown> | null, p: VerificationPurpose): Record<string, unknown> {
  const s = doc?.[p];
  return s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
}

/** Pure: may NEW verification work for `p` be admitted or dispatched now? */
export function purposeSendingAllowed(
  p: VerificationPurpose, doc: Record<string, unknown> | null, env: NodeJS.ProcessEnv = process.env,
): boolean {
  const s = resolveShared(doc);
  return purposeEnvEnabled(p, env) && s.masterEnabled && !s.emergencyStop
    && s.businessId !== null && purposeSection(doc, p).enabled === true;
}

/** Read the raw policy doc (null when absent). Throws when unreadable so callers fail closed. */
export async function loadPolicyDoc(db: Firestore): Promise<Record<string, unknown> | null> {
  const snap = await db.collection(OTP_POLICY_DOC.collection).doc(OTP_POLICY_DOC.doc).get();
  return snap.exists ? (snap.data() ?? {}) : null;
}

/**
 * Pure: is an already-queued/claimed verification job still allowed to go out
 * under the CURRENT policy? Binds the job to the sender organization and policy
 * generation it was admitted under, and to its expiry.
 */
export function verificationJobStillValid(
  job: { purpose: VerificationPurpose | null; businessId: unknown; policyVersion: unknown; expiresAtMs: number | null },
  doc: Record<string, unknown> | null,
  nowMs: number,
  env: NodeJS.ProcessEnv = process.env,
): 'ok' | 'expired' | 'sending-stopped' | 'policy-changed' {
  if (job.expiresAtMs == null || job.expiresAtMs <= nowMs) return 'expired';
  if (!job.purpose || !purposeSendingAllowed(job.purpose, doc, env)) return 'sending-stopped';
  const s = resolveShared(doc);
  if (job.businessId !== s.businessId || job.policyVersion !== s.policyVersion) return 'policy-changed';
  return 'ok';
}
