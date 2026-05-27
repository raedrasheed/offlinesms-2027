// Phase 22 — deterministic conflict resolution. Pure (no native/db imports) so
// it is fully unit-testable in node. See OFFLINESMS_SYNC_PROTOCOL.md.

import type { ReceiptStatus } from '../types';

const RECEIPT_RANK: Record<ReceiptStatus, number> = {
  pending: 0,
  failed: 0,     // failed is terminal-but-low; never blocks an upgrade to delivered+
  delivered: 1,
  read: 2,
  viewed: 2,
  played: 3,
};

/**
 * Merge two receipt statuses, never downgrading.
 * pending < delivered < read/viewed < played. `failed` only stands if nothing
 * better has been observed.
 */
export function mergeReceiptStatus(current: ReceiptStatus, incoming: ReceiptStatus): ReceiptStatus {
  if (current === incoming) return current;
  // A real delivery signal always beats a prior 'failed'.
  if (current === 'failed' && RECEIPT_RANK[incoming] >= 1) return incoming;
  if (incoming === 'failed') return current === 'pending' ? 'failed' : current;
  return RECEIPT_RANK[incoming] > RECEIPT_RANK[current] ? incoming : current;
}

export interface MessageSnapshot {
  text: string | null;
  editedAt: number | null;
  deletedForEveryone: boolean;
  remoteCreatedAt: number | null;
  serverVersion: number;
}

export type MessageResolution =
  | { action: 'keep-local' }
  | { action: 'take-remote' }
  | { action: 'delete-for-everyone' };

/**
 * Resolve a content conflict between the local row and the remote snapshot.
 * - Remote delete-for-everyone always wins.
 * - Otherwise the newer edit (by server timestamp / version) wins.
 */
export function resolveMessageConflict(local: MessageSnapshot, remote: MessageSnapshot): MessageResolution {
  if (remote.deletedForEveryone) return { action: 'delete-for-everyone' };
  if (local.deletedForEveryone) return { action: 'keep-local' };

  if (remote.serverVersion > local.serverVersion) return { action: 'take-remote' };
  if (remote.serverVersion < local.serverVersion) return { action: 'keep-local' };

  const lEdit = local.editedAt ?? local.remoteCreatedAt ?? 0;
  const rEdit = remote.editedAt ?? remote.remoteCreatedAt ?? 0;
  if (rEdit > lEdit) return { action: 'take-remote' };
  return { action: 'keep-local' };
}

/**
 * Whether a locally-pending message (no remote_id yet) matches an incoming
 * remote message — used to reconcile optimistic sends instead of duplicating.
 */
export function matchesPendingLocal(
  localIdValue: string | null,
  remoteClientLocalId: string | null | undefined,
): boolean {
  return !!localIdValue && !!remoteClientLocalId && localIdValue === remoteClientLocalId;
}
