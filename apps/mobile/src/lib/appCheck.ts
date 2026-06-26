// App Check (client) — F2, staged. Safe to call always; never throws.
//
// IMPORTANT STACK CONSTRAINT: this app uses the Firebase WEB JS SDK. The web SDK
// only has a real App Check attestation provider on WEB (reCAPTCHA). On native
// iOS/Android the JS SDK has NO device-attestation provider, so this is a
// documented NO-OP on native until @react-native-firebase/app-check (a native
// module) is added — see docs/APP_CHECK.md. Because native can't mint tokens
// yet, App Check enforcement on the backend stays OFF (functions: appCheck.ts).
//
// Env:
//   EXPO_PUBLIC_APPCHECK_RECAPTCHA_KEY  — reCAPTCHA v3 site key (web only)
//   EXPO_PUBLIC_APPCHECK_DEBUG=1        — register a debug token (local dev/web)

import { Platform } from 'react-native';

let started = false;

/** Initialize App Check where supported. No-op on native and when unconfigured. */
export function initAppCheck(): void {
  if (started) return;
  started = true;

  // Native attestation requires a native module; skip until that ships.
  if (Platform.OS !== 'web') return;

  const siteKey = process.env.EXPO_PUBLIC_APPCHECK_RECAPTCHA_KEY;
  if (!siteKey) return; // not configured → nothing to enforce against; skip.

  try {
    // Lazy require so native bundles never pull DOM-only App Check code.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { initializeAppCheck, ReCaptchaV3Provider } = require('firebase/app-check');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('./firebase');

    // Debug token for local development (must be set before initializeAppCheck).
    if (process.env.EXPO_PUBLIC_APPCHECK_DEBUG === '1') {
      (globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean })
        .FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Never block app startup on App Check setup.
  }
}
