// Phase 22 — local id + idempotency key generation. Pure (no native import)
// so it is unit-testable in node. IDs are opaque, collision-resistant strings.

function rand(n = 8): string {
  let out = '';
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Local message id, e.g. local_msg_<deviceId>_<ts>_<rand>. */
export function localMessageId(deviceId: string): string {
  return `local_msg_${deviceId}_${Date.now()}_${rand()}`;
}

/** Generic local row id for a given entity, e.g. local_outbox_<ts>_<rand>. */
export function localId(entity: string): string {
  return `local_${entity}_${Date.now()}_${rand()}`;
}

/**
 * Idempotency key for an outbox item. Deterministic where a natural key exists
 * (so the same logical action enqueued twice collapses to one row), random
 * otherwise. The key is what prevents duplicate remote writes on retry.
 */
export function idempotencyKey(parts: Array<string | number | null | undefined>): string {
  const base = parts.filter(p => p != null && p !== '').join(':');
  return base.length > 0 ? base : `idem_${Date.now()}_${rand(12)}`;
}

/** Stable device id (generated once, then persisted in sync_state). */
export function newDeviceId(): string {
  return `dev_${Date.now()}_${rand(10)}`;
}
