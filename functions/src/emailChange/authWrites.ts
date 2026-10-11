// Durable ledger of the Firebase Auth email writes made by the email-change
// flow, and the repair that keeps Auth on the account's settled address.
//
// Firebase Auth has no compare-and-set, and a Cloud Run request timeout does
// not stop the code that is still running, so the flow never assumes an Auth
// write has stopped just because time passed. Instead every write is recorded
// BEFORE it is sent (emailChangeAuthWrites/{uid}.pending) and resolved by its
// own worker after the call returns:
//   - a new change is not accepted while any write is still pending;
//   - a write that lost to a newer change marks that change dirty (it re-runs
//     its write before finalizing) or, once changes are settled, is undone;
//   - a write whose outcome is unknown (timeout, network) or whose worker
//     vanished (pending past ABANDON_MS) is kept as `uncertain` and the
//     account is reconciled against its settled address on every later step
//     and by a scheduled sweep, until UNCERTAIN_KEEP_MS has passed.
//
// The settled address is `settledEmail` on this ledger: written only by the
// email-change flow (at acceptance when absent, and in the finalize
// transaction), never by sign-in. Sign-in routes refuse any address that is
// not the settled one (./signInGuard.ts), so a stale Auth mapping can neither
// sign anyone in nor overwrite what the repair restores.

import { randomBytes } from 'node:crypto';
import { getFirestore, FieldValue, type Firestore, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';
import { authErrorCode } from '../phoneLink/shared';
import { EMAIL_CHANGE_COLLECTIONS as C } from './logic';

export const AUTH_WRITES = 'emailChangeAuthWrites';
/** A pending write whose worker has not resolved it for this long is treated as uncertain. */
export const ABANDON_MS = 10 * 60_000;
/** Uncertain writes are reconciled for this long after they were recorded. */
export const UNCERTAIN_KEEP_MS = 24 * 3600_000;
export const RECONCILE_EVERY_MS = 15 * 60_000;

const NONTERMINAL = new Set(['verified', 'auth-updated']);

export interface WriteEntry { email: string; challengeId: string; kind: 'change' | 'restore'; atMs: number }
export interface Ledger {
  pending?: Record<string, WriteEntry>;
  uncertain?: Record<string, WriteEntry & { sinceMs: number }>;
  reconcileAtMs?: number;
  /** The account's settled (authoritative) email address, lowercased. */
  settledEmail?: string;
  /** A repair Auth refused (e.g. the address was claimed meanwhile): needs support. */
  conflict?: { code: string; atMs: number } | null;
}

export type ReconcileResult = 'consistent' | 'no-authority' | 'dirty' | 'in-progress' | 'repaired' | 'rejected' | 'unknown';

export const settledEmailOf = (l: Ledger | undefined): string | null =>
  typeof l?.settledEmail === 'string' && l.settledEmail ? l.settledEmail.toLowerCase() : null;

/** Seams for adversarial tests. Production never reassigns them. */
export const authWriteDeps = {
  setAuthEmail: async (uid: string, email: string): Promise<void> => {
    await getAuth().updateUser(uid, { email, emailVerified: true });
  },
};

export const ledgerRef = (db: Firestore, uid: string) => db.collection(AUTH_WRITES).doc(uid);
export const newWriteId = () => randomBytes(12).toString('hex');

/** Pure: live (not yet abandoned) pending writes, and how long until the oldest is abandoned. */
export function liveWrites(l: Ledger | undefined, now: number): { count: number; retryAfterSec: number } {
  const live = Object.values(l?.pending ?? {}).filter(e => now - e.atMs < ABANDON_MS);
  if (!live.length) return { count: 0, retryAfterSec: 0 };
  const oldest = Math.min(...live.map(e => e.atMs));
  return { count: live.length, retryAfterSec: Math.max(1, Math.ceil((oldest + ABANDON_MS - now) / 1000)) };
}

/** Pure: did this Auth error leave the write's outcome unknown? Only definite refusals are certain. */
export function writeOutcomeUnknown(e: unknown): boolean {
  const code = authErrorCode(e);
  return !['auth/email-already-exists', 'auth/invalid-email', 'auth/user-not-found', 'auth/invalid-uid'].includes(code ?? '');
}

/** Inside a transaction that already read the ledger: record a write before it is sent. */
export function recordPending(tx: Transaction, ref: DocumentReference, l: Ledger | undefined, writeId: string, entry: WriteEntry): void {
  // The scheduled pass looks at this account once the write could be abandoned.
  const due = Math.min(l?.reconcileAtMs ?? Infinity, entry.atMs + ABANDON_MS);
  tx.set(ref, { pending: { [writeId]: entry }, reconcileAtMs: due, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Inside a transaction: resolve a write — certain (drop it) or unknown (keep it as uncertain). */
export function resolvePending(tx: Transaction, ref: DocumentReference, l: Ledger | undefined, writeId: string, unknown: boolean, now: number): void {
  const e = l?.pending?.[writeId];
  const patch: Record<string, unknown> = { [`pending.${writeId}`]: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() };
  if (unknown && e) {
    patch[`uncertain.${writeId}`] = { ...e, sinceMs: now };
    patch.reconcileAtMs = now + RECONCILE_EVERY_MS;
  }
  if (l) tx.update(ref, patch);
}

/** Move pending writes whose worker vanished to `uncertain`. Returns whether any are uncertain now. */
export async function sweepAbandoned(uid: string, now = Date.now()): Promise<boolean> {
  const db = getFirestore();
  const ref = ledgerRef(db, uid);
  return db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    const l = s.data() as Ledger;
    const patch: Record<string, unknown> = {};
    for (const [id, e] of Object.entries(l.pending ?? {})) {
      if (now - e.atMs >= ABANDON_MS) {
        patch[`pending.${id}`] = FieldValue.delete();
        patch[`uncertain.${id}`] = { ...e, sinceMs: now };
      }
    }
    if (Object.keys(patch).length) {
      patch.reconcileAtMs = now + RECONCILE_EVERY_MS;
      tx.update(ref, patch);
      return true;
    }
    return Object.keys(l.uncertain ?? {}).length > 0;
  });
}

/**
 * Make Auth carry the account's settled address (ledger.settledEmail). While a
 * change is in progress it is only marked dirty: that change re-runs its own
 * write before it may finalize. Once settled, Auth is set back through a
 * recorded (fenced) write and then READ BACK; only a read-back that shows the
 * settled address counts as repaired. A definite refusal from Auth is
 * `rejected` (recorded as a conflict for support), an unknown outcome is
 * `unknown`; neither ever counts as success. Safe to call any number of times.
 */
export async function reconcileAuthEmail(
  uid: string, opts: { markDirty?: boolean } = {}, depth = 0,
): Promise<ReconcileResult> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(uid);
  const lRef = ledgerRef(db, uid);
  const [opS, lS] = await Promise.all([opRef.get(), lRef.get()]);
  if (opS.exists && NONTERMINAL.has(opS.get('stage'))) {
    // That change's own finalize re-reads Auth; a stale writer that reports in
    // also marks it dirty so it re-writes before finishing.
    if (opts.markDirty === false) return 'in-progress';
    await db.runTransaction(async tx => {
      const s = await tx.get(opRef);
      if (s.exists && NONTERMINAL.has(s.get('stage'))) tx.update(opRef, { authDirty: true, updatedAt: FieldValue.serverTimestamp() });
    });
    return 'dirty';
  }
  const settled = settledEmailOf(lS.exists ? (lS.data() as Ledger) : undefined);
  if (!settled) return 'no-authority'; // no email has ever been settled by this flow
  let current: string;
  try { current = ((await getAuth().getUser(uid)).email ?? '').toLowerCase(); } catch { return 'unknown'; }
  if (current === settled) {
    if (lS.get('conflict')) await lRef.update({ conflict: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
    return 'consistent';
  }

  // Fenced restore: recorded first, only while the account is still settled on `settled`.
  const writeId = newWriteId();
  const now = Date.now();
  const ok = await db.runTransaction(async tx => {
    const [s, l] = await tx.getAll(opRef, lRef);
    if (s.exists && NONTERMINAL.has(s.get('stage'))) return false;
    const ld = l.exists ? (l.data() as Ledger) : undefined;
    if (settledEmailOf(ld) !== settled) return false;
    recordPending(tx, lRef, ld, writeId, { email: settled, challengeId: (s.get('challengeId') as string) ?? 'restore', kind: 'restore', atMs: now });
    return true;
  });
  if (!ok) return depth < 2 ? reconcileAuthEmail(uid, opts, depth + 1) : 'unknown';

  let outcome: 'applied' | 'rejected' | 'unknown' = 'applied';
  let code = '';
  try {
    await authWriteDeps.setAuthEmail(uid, settled);
  } catch (e) {
    code = authErrorCode(e) || 'error';
    outcome = writeOutcomeUnknown(e) ? 'unknown' : 'rejected';
    console.warn('[emailChange] repair write failed', { uid, code });
  }
  if (outcome === 'applied') {
    // Trust only what Auth now says.
    try {
      if (((await getAuth().getUser(uid)).email ?? '').toLowerCase() !== settled) { outcome = 'unknown'; code = 'readback-mismatch'; }
    } catch { outcome = 'unknown'; code = 'readback-failed'; }
  }
  const stillSettled = await db.runTransaction(async tx => {
    const [s, l] = await tx.getAll(opRef, lRef);
    const ld = l.exists ? (l.data() as Ledger) : undefined;
    // A refused write never happened; an unknown one may still land.
    resolvePending(tx, lRef, ld, writeId, outcome === 'unknown', Date.now());
    if (outcome !== 'applied' && l.exists) {
      tx.update(lRef, {
        reconcileAtMs: Math.min(ld?.reconcileAtMs ?? Infinity, Date.now() + RECONCILE_EVERY_MS),
        ...(outcome === 'rejected' ? { conflict: { code, atMs: Date.now() } } : {}),
      });
    }
    return !(s.exists && NONTERMINAL.has(s.get('stage'))) && settledEmailOf(ld) === settled;
  });
  await writeAuditLog({
    action: outcome === 'rejected' ? 'emailChange.authEmailRepairRejected' : 'emailChange.authEmailRepaired',
    actor: { uid }, target: { type: 'account', id: uid },
    result: outcome === 'applied' ? 'success' : 'failure',
    ...(outcome === 'applied' ? {} : { metadata: { code } }),
  });
  // The settled address moved on while this repair was in flight: repair again.
  if (!stillSettled && depth < 2) return reconcileAuthEmail(uid, opts, depth + 1);
  return outcome === 'applied' ? 'repaired' : outcome;
}

/** Sweep abandoned writes and, when any write is uncertain, reconcile. */
export async function settleUncertain(uid: string): Promise<void> {
  if (await sweepAbandoned(uid)) await reconcileAuthEmail(uid, { markDirty: false });
}

/**
 * Scheduled pass: reconcile every account with uncertain writes until they age
 * out (only once Auth is consistent), and abandon vanished pending writes.
 */
export async function runReconcilePass(now = Date.now(), limit = 200): Promise<number> {
  const db = getFirestore();
  const due = await db.collection(AUTH_WRITES).where('reconcileAtMs', '<=', now).limit(limit).get();
  for (const d of due.docs) {
    const uid = d.id;
    try {
      await sweepAbandoned(uid, now);
      const state = await reconcileAuthEmail(uid, { markDirty: false });
      await db.runTransaction(async tx => {
        const s = await tx.get(d.ref);
        if (!s.exists) return;
        const l = s.data() as Ledger;
        const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
        let left = 0;
        for (const [id, e] of Object.entries(l.uncertain ?? {})) {
          if (state === 'consistent' && now - e.sinceMs >= UNCERTAIN_KEEP_MS) patch[`uncertain.${id}`] = FieldValue.delete();
          else left++;
        }
        // Keep looking while anything is unresolved or Auth is not (yet) back on the settled address.
        const open = left || Object.keys(l.pending ?? {}).length || !['consistent', 'repaired', 'no-authority'].includes(state);
        patch.reconcileAtMs = open ? now + RECONCILE_EVERY_MS : FieldValue.delete();
        tx.update(d.ref, patch);
      });
    } catch (e) {
      console.warn('[emailChange] reconcile pass failed for account', { uid, reason: (e as Error)?.message });
    }
  }
  return due.size;
}
