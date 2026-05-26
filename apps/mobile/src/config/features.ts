// Phase 22B — mobile feature flags.
//
// Build-time flags read from Expo public env vars (EXPO_PUBLIC_*). Defaults are
// chosen so production behaviour is unchanged until a flag is explicitly set.

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * When true, the chat list reads from the local SQLite DB (Phase 22B) instead
 * of subscribing to Firestore directly. Defaults OFF; overridable via
 * EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST=1 on a dev/QA build. If the local DB cannot
 * initialise the UI falls back to the existing Firestore path.
 */
export const LOCAL_FIRST_CHAT_LIST_ENABLED = envFlag('EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST', false);
