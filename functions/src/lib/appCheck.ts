// App Check enforcement options for callables (F2 — staged rollout).
//
// firebase-functions v2 onCall supports per-callable `enforceAppCheck` and
// `consumeAppCheckToken`. We gate enforcement behind an env flag so it can be
// turned on per-environment and rolled back INSTANTLY without editing each
// function. Default is OFF (unenforced): tokens are accepted if present but
// never required, so existing clients — and the current mobile app, which
// cannot yet mint App Check tokens (web JS SDK on native) — keep working.
//
//   APPCHECK_ENFORCE = 'on'         → enforce on callables that opt in below
//   APPCHECK_ENFORCE = 'off'/unset  → not enforced (default)
//
// ⚠️  DO NOT set APPCHECK_ENFORCE=on until the mobile app ships a real App Check
//     attestation provider (Play Integrity / App Attest) AND App Check metrics
//     in the Firebase console show ~100% verified traffic. Enforcing earlier
//     locks out all mobile users. See docs/APP_CHECK.md for the rollout.

export function appCheckEnforced(): boolean {
  return (process.env.APPCHECK_ENFORCE ?? 'off').trim().toLowerCase() === 'on';
}

/**
 * CallableOptions fragment to spread into `onCall({ ... })`. When enforcement is
 * off this is a no-op (App Check tokens optional), so wiring it into a callable
 * today changes no behavior — it only makes the env flag able to enable
 * enforcement later without a code change.
 */
export function appCheckOptions(
  opts: { replayProtected?: boolean } = {},
): { enforceAppCheck: boolean; consumeAppCheckToken: boolean } {
  return {
    enforceAppCheck: appCheckEnforced(),
    // Replay protection (limited-use tokens, consumed on verification) only for
    // callables that opt in AND when APPCHECK_CONSUME=on. Clients must then
    // send limited-use tokens; enabling it before they do rejects nothing (the
    // token is just absent) unless enforcement or policy `attestation:
    // 'required'` is also on.
    consumeAppCheckToken: !!opts.replayProtected
      && (process.env.APPCHECK_CONSUME ?? 'off').trim().toLowerCase() === 'on',
  };
}
