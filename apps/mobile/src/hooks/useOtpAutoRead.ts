// Android SMS Retriever — zero-tap OTP auto-read.
//
// When the verification SMS arrives AND its body ends with this app's 11-char
// signature hash, Android's SMS Retriever API hands us the message with no SMS
// permission and no user interaction. We pull the numeric code out and hand it
// back to the caller, which auto-verifies.
//
// Deliberately defensive:
//   - iOS has no SMS Retriever (it uses the `oneTimeCode` keyboard suggestion
//     instead), so this is a no-op there.
//   - The native module (`react-native-otp-verify`) only links in a dev/EAS
//     build. In Expo Go, or before the next native build, the lazy require
//     throws and we silently fall back to the 1-tap keyboard autofill — the
//     screen still works, it just isn't zero-tap.

import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Return this Android build's SMS Retriever signature hash(es). Set the value
 * in Firestore at smsConfig/otp.androidAppHash so requestPhoneOtp appends it to
 * the OTP SMS (which is what makes zero-tap auto-read fire). The hash differs
 * per signing key (debug vs release) — read it from the build you ship.
 *
 * Returns null on iOS or when the native module isn't linked yet (Expo Go).
 */
export async function getAndroidAppHash(): Promise<string[] | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const mod = require('react-native-otp-verify');
    const RNOtpVerify = mod?.default ?? mod;
    if (!RNOtpVerify?.getHash) return null;
    const hashes = await RNOtpVerify.getHash();
    return Array.isArray(hashes) ? hashes : null;
  } catch {
    return null;
  }
}

/**
 * Subscribe to the Android SMS Retriever and call `onCode` with the extracted
 * verification code. `onCode` should be stable (wrap in useCallback) so the
 * listener isn't torn down/re-created on every render.
 */
export function useOtpAutoRead(onCode: (code: string) => void, length = 6): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // Lazy require: a static import would make Metro hard-fail when the module
    // (a native dep) isn't installed/linked yet.
    let RNOtpVerify: any;
    try {
      const mod = require('react-native-otp-verify');
      RNOtpVerify = mod?.default ?? mod;
    } catch {
      return; // module absent (Expo Go / pre-rebuild) → graceful no-op
    }
    if (!RNOtpVerify?.getOtp || !RNOtpVerify?.addListener) return;

    let active = true;
    const handle = (message: string | null) => {
      if (!active || !message) return;
      try {
        // Avoid look-behind/ahead (not supported on all Hermes versions). Pull
        // every digit run, prefer an exactly-`length` one, else the first run of
        // at least 4 digits.
        const runs = message.match(/\d+/g) ?? [];
        const code = (runs.find(r => r.length === length) ?? runs.find(r => r.length >= 4) ?? '').slice(0, length);
        if (__DEV__) console.log('[OTP] retriever message:', JSON.stringify(message), '→ code:', code);
        if (code.length === length) onCode(code);
      } catch (e) {
        if (__DEV__) console.log('[OTP] retriever parse error:', e);
      }
    };

    try {
      RNOtpVerify.getOtp()
        .then((started: boolean) => { if (__DEV__) console.log('[OTP] retriever started:', started); RNOtpVerify.addListener(handle); })
        .catch((e: unknown) => { if (__DEV__) console.log('[OTP] retriever unavailable:', e); });
    } catch (e) {
      if (__DEV__) console.log('[OTP] retriever init threw:', e);
    }

    return () => {
      active = false;
      try { RNOtpVerify.removeListener?.(); } catch { /* ignore */ }
    };
  }, [onCode, length]);
}
