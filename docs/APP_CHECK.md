# App Check (F2) — staged rollout

App Check attests that requests come from your genuine app, blocking abuse of the
UNAUTH OTP callables (SMS/email pumping, enumeration). This is wired in a
**prepared-but-not-enforced** state. **Nothing is enforced yet** — flipping it on
before the mobile client can mint tokens would lock out all users.

## Current state in code
- **Functions** (`functions/src/lib/appCheck.ts`): `appCheckOptions()` returns
  `{ enforceAppCheck, consumeAppCheckToken:false }` driven by the env flag
  `APPCHECK_ENFORCE` (**default OFF**). Wired into the high-risk UNAUTH callables:
  `requestPhoneOtp`, `verifyPhoneOtp`, `requestEmailOtp`, `verifyEmailOtp`,
  `getSupportedPhoneCountries`. With the flag off these accept requests exactly as
  before (tokens optional).
- **Mobile** (`apps/mobile/src/lib/appCheck.ts`, called from `App.tsx`):
  initializes App Check **only on web** with a configured reCAPTCHA key, with
  debug-token support. **No-op on native** (see constraint below). Never throws.

## ⚠️ Stack constraint (the gating prerequisite)
The mobile app uses the **Firebase web JS SDK** on React Native. The web SDK has
**no native attestation provider** (Play Integrity / App Attest / DeviceCheck).
So **native iOS/Android cannot mint App Check tokens today**, and enforcement on
any mobile-facing callable must stay OFF.

To enforce on mobile you must first add native attestation — **needs a decision**:
- **Option A:** `@react-native-firebase/app-check` (+ `@react-native-firebase/app`)
  via an Expo config plugin + custom dev client. Adds the RN Firebase native layer
  alongside the JS SDK.
- **Option B:** a custom native module that produces a Play Integrity / App Attest
  token and feeds the JS SDK `CustomProvider`.

Until one ships, only the **web** surfaces (dashboard, Expo web) can attest.

## Firebase Console setup (you must do this)
1. **App Check** → register each app:
   - Android → **Play Integrity**
   - iOS → **App Attest** (and DeviceCheck fallback)
   - Web (dashboard / Expo web) → **reCAPTCHA v3** (or Enterprise)
2. Put the reCAPTCHA **site key** into the env:
   - Mobile web: `EXPO_PUBLIC_APPCHECK_RECAPTCHA_KEY`
   - (Dashboard init is a later sub-step; not wired yet.)
3. **Debug tokens** for development: run the web app with
   `EXPO_PUBLIC_APPCHECK_DEBUG=1`, copy the console-logged debug token into
   App Check → *Manage debug tokens*.
4. Leave **every provider "Unenforced"** in the console while you watch the
   App Check **metrics** (verified vs unverified requests).

## Local development / emulators
- The **Functions emulator does not enforce App Check** — local dev is unaffected
  regardless of `APPCHECK_ENFORCE`.
- For web/dev attestation use the debug token (step 3).

## Safe rollout (do not skip the order)
1. **Deploy unenforced** (current state). Watch console metrics for a few days.
2. Ship a **mobile build that mints tokens** (after the native module, Option A/B).
3. When metrics show **~100% verified** traffic, enable enforcement **gradually**
   by setting `APPCHECK_ENFORCE=on` (functions env) — start by limiting the opt-in
   set in `appCheck.ts` to low-risk **authed** callables, then finally the UNAUTH
   OTP callables.
4. The env flag is the **instant rollback** — set it back to `off` and redeploy.

> Do not set `APPCHECK_ENFORCE=on` until steps 1–3 are done. This is a breaking
> change and must be confirmed before deploying.

## What is enforced now vs prepared
| Surface | State |
| --- | --- |
| All callables | **Not enforced** (`APPCHECK_ENFORCE` default off) |
| OTP/mobile callables | **Prepared** — env-gated, off |
| Mobile native App Check | **Not available** — needs native module |
| Mobile web / dashboard | Can attest once reCAPTCHA key + console setup done |
