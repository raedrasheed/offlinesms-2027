// Phase 22B — mobile feature flags.
//
// Build-time flags read from Expo public env vars (EXPO_PUBLIC_*). A flag's
// default applies unless its EXPO_PUBLIC_* var is explicitly set ("0"/"false"
// to disable, "1"/"true" to enable).

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

/**
 * When true, the chat list reads from the local SQLite DB (Phase 22B) instead
 * of subscribing to Firestore directly — the list renders instantly from cache
 * while the feeder reconciles in the background. Defaults ON; set
 * EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST=0 to force the legacy Firestore path. If the
 * local DB cannot initialise the UI falls back to Firestore automatically.
 */
export const LOCAL_FIRST_CHAT_LIST_ENABLED = envFlag('EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST', true);

/**
 * Phase 22C — when true, the Conversation screen reads messages from the local
 * SQLite DB (instant open from cache) and sends through the outbox + sync engine
 * instead of calling sendTextMessage directly. Defaults ON; set
 * EXPO_PUBLIC_LOCAL_FIRST_CONVERSATION=0 to force the legacy path. Falls back to
 * the Firestore + OfflineContext path if the local DB cannot initialise.
 */
export const LOCAL_FIRST_CONVERSATION_ENABLED = envFlag('EXPO_PUBLIC_LOCAL_FIRST_CONVERSATION', true);
