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

export function relayEnabled(mode: SmsProviderMode): boolean {
  return mode === 'relay' || mode === 'relay_with_http_fallback';
}

export function httpFallbackEnabled(mode: SmsProviderMode): boolean {
  return mode === 'relay_with_http_fallback' || mode === 'http';
}
