// SMS provider routing (Phase 24). Default 'http' so production is unchanged
// until relay is explicitly enabled. Config doc: smsConfig/providers
//   { default: 'http' | 'relay' | 'relay_with_http_fallback',
//     byBusiness: { [businessId]: mode } }
//
// NOT yet wired into escalateSms — escalate.ts keeps calling the HTTP gateway
// directly. Wiring relay into the send path is a later phase; this resolver and
// the dispatcher exist so the contract + tests can exercise the relay flow now.

import { getFirestore } from 'firebase-admin/firestore';

export type SmsProviderMode = 'http' | 'relay' | 'relay_with_http_fallback';

export async function resolveProvider(businessId?: string | null): Promise<SmsProviderMode> {
  try {
    const snap = await getFirestore().collection('smsConfig').doc('providers').get();
    if (!snap.exists) return 'http';
    const data = snap.data() as { default?: SmsProviderMode; byBusiness?: Record<string, SmsProviderMode> };
    if (businessId && data.byBusiness?.[businessId]) return data.byBusiness[businessId];
    return data.default ?? 'http';
  } catch {
    return 'http'; // fail safe to the existing provider
  }
}

/** The business whose relay device(s) handle SMS when the sender has no org of
 *  their own (e.g. a regular app user). Configured via
 *  smsConfig/providers.defaultBusinessId, falling back to the OTP relay org
 *  (smsConfig/otp.businessId). Returns null when neither is set. */
export async function resolveDefaultRelayBusiness(): Promise<string | null> {
  try {
    const db = getFirestore();
    const prov = await db.collection('smsConfig').doc('providers').get();
    const provDefault = prov.data()?.defaultBusinessId as string | undefined;
    if (provDefault && provDefault.trim()) return provDefault.trim();
    const otp = await db.collection('smsConfig').doc('otp').get();
    const otpBiz = otp.data()?.businessId as string | undefined;
    return otpBiz && otpBiz.trim() ? otpBiz.trim() : null;
  } catch {
    return null;
  }
}

export function relayEnabled(mode: SmsProviderMode): boolean {
  return mode === 'relay' || mode === 'relay_with_http_fallback';
}

export function httpFallbackEnabled(mode: SmsProviderMode): boolean {
  return mode === 'relay_with_http_fallback' || mode === 'http';
}
