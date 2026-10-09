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

import { randomBytes } from 'node:crypto';
import { getFirestore, FieldValue, type Firestore, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';
import { userPrivateProfileRef } from '../lib/userPrivate';
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
}

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
 * Make Auth carry the account's settled address. While a change is in progress
 * it is only marked dirty: that change re-runs its own write before it may
 * finalize. Once settled (done/failed/no change), Auth is set back to the
 * address in the private profile through a recorded (fenced) write. Safe to
 * call any number of times.
 */
export async function reconcileAuthEmail(
  uid: string, opts: { markDirty?: boolean } = {}, depth = 0,
): Promise<'consistent' | 'dirty' | 'in-progress' | 'repaired' | 'unknown'> {
  const db = getFirestore();
  const opRef = db.collection(C.ops).doc(uid);
  const lRef = ledgerRef(db, uid);
  const [opS, priv] = await Promise.all([opRef.get(), userPrivateProfileRef(db, uid).get()]);
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
  const settled = priv.get('email') as string | undefined;
  if (!settled) return 'unknown';
  let current: string;
  try { current = (await getAuth().getUser(uid)).email ?? ''; } catch { return 'unknown'; }
  if (current.toLowerCase() === settled.toLowerCase()) return 'consistent';

  // Fenced restore: recorded first, only while the account is still settled on `settled`.
  const writeId = newWriteId();
  const now = Date.now();
  const ok = await db.runTransaction(async tx => {
    const [s, p, l] = await tx.getAll(opRef, userPrivateProfileRef(db, uid), lRef);
    if (s.exists && NONTERMINAL.has(s.get('stage'))) return false;
    if ((p.get('email') as string | undefined) !== settled) return false;
    recordPending(tx, lRef, l.exists ? (l.data() as Ledger) : undefined, writeId, { email: settled, challengeId: (s.get('challengeId') as string) ?? 'restore', kind: 'restore', atMs: now });
    return true;
  });
  if (!ok) return depth < 2 ? reconcileAuthEmail(uid, opts, depth + 1) : 'unknown';
  let unknown = false;
  try {
    await authWriteDeps.setAuthEmail(uid, settled);
  } catch (e) {
    unknown = writeOutcomeUnknown(e);
    console.warn('[emailChange] repair write failed', { uid, code: authErrorCode(e) });
  }
  const stillSettled = await db.runTransaction(async tx => {
    const [s, p, l] = await tx.getAll(opRef, userPrivateProfileRef(db, uid), lRef);
    resolvePending(tx, lRef, l.exists ? (l.data() as Ledger) : undefined, writeId, unknown, Date.now());
    return !(s.exists && NONTERMINAL.has(s.get('stage'))) && (p.get('email') as string | undefined) === settled;
  });
  await writeAuditLog({ action: 'emailChange.authEmailRepaired', actor: { uid }, target: { type: 'account', id: uid }, result: unknown ? 'failure' : 'success' });
  // The settled address moved on while this repair was in flight: repair again.
  if (!stillSettled && depth < 2) return reconcileAuthEmail(uid, opts, depth + 1);
  return unknown ? 'unknown' : 'repaired';
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
        patch.reconcileAtMs = left || Object.keys(l.pending ?? {}).length ? now + RECONCILE_EVERY_MS : FieldValue.delete();
        tx.update(d.ref, patch);
      });
    } catch (e) {
      console.warn('[emailChange] reconcile pass failed for account', { uid, reason: (e as Error)?.message });
    }
  }
  return due.size;
}
