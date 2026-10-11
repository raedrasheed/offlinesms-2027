// Sign-in guard for accounts whose email went through the add/change flow.
//
// Firebase Auth resolves an email sign-in through the Auth record. If a stale
// Auth write ever puts a replaced address back on the record (see
// ./authWrites.ts), that address must still not sign in, must not be able to
// request a password reset, and must not overwrite the settled address. Every
// supported email route checks the address against the account's settled one
// (emailChangeAuthWrites/{uid}.settledEmail):
//   - email-code sign-in  (verifyEmailOtp, server side)
//   - email + password    (beforeUserSignedIn blocking function)
//   - password reset / email-link emails (beforeEmailSent blocking function)
// A refused address also triggers the repair at once, so the old mapping is
// removed without waiting for the scheduled pass.
//
// Accounts that never used the change flow have no settled address and are
// not affected.

import { HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { writeAuditLog } from '../lib/auditLog';
import { EMAIL_CHANGE_COLLECTIONS as C } from './logic';
import { ledgerRef, reconcileAuthEmail, settledEmailOf, type Ledger } from './authWrites';

const NONTERMINAL = new Set(['verified', 'auth-updated']);
const REPAIR_BUDGET_MS = 4_000;

/**
 * May `email` authenticate as account `uid`? Yes when the account has no
 * settled address, when it IS the settled address, or when it is the target of
 * this account's in-progress change (Auth may already carry it; the change
 * finalizes on its own). Anything else is a replaced address.
 */
export async function addressMayAuthenticate(uid: string, email: string): Promise<boolean> {
  const db = getFirestore();
  const addr = email.trim().toLowerCase();
  const [l, op] = await Promise.all([ledgerRef(db, uid).get(), db.collection(C.ops).doc(uid).get()]);
  const settled = settledEmailOf(l.exists ? (l.data() as Ledger) : undefined);
  if (!settled || addr === settled) return true;
  if (op.exists && NONTERMINAL.has(op.get('stage')) && typeof op.get('email') === 'string' && (op.get('email') as string).toLowerCase() === addr) return true;
  return false;
}

/** Repair now (bounded, best effort) and make sure the scheduled pass looks too. */
async function repairSoon(uid: string): Promise<void> {
  const db = getFirestore();
  await ledgerRef(db, uid).set({ reconcileAtMs: Date.now(), updatedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
  await Promise.race([
    reconcileAuthEmail(uid, { markDirty: false }).catch(e => console.warn('[signInGuard] repair failed', { uid, reason: (e as Error)?.message })),
    new Promise(r => setTimeout(r, REPAIR_BUDGET_MS)),
  ]);
}

async function refuse(uid: string, route: string): Promise<void> {
  await writeAuditLog({
    action: 'auth.replaced-address.refused', actor: { uid }, target: { type: 'account', id: uid },
    result: 'failure', metadata: { route },
  }).catch(() => {});
  await repairSoon(uid);
}

/** For server-side email sign-in: throws `address-replaced` for a replaced address. */
export async function requireCurrentAddress(uid: string, email: string, route: string): Promise<void> {
  if (await addressMayAuthenticate(uid, email)) return;
  await refuse(uid, route);
  throw new HttpsError('permission-denied', 'address-replaced');
}

interface BlockingEventLike {
  data?: { uid?: string; email?: string | null };
  additionalUserInfo?: { providerId?: string; email?: string };
  credential?: { providerId?: string; signInMethod?: string };
  emailType?: string;
}

/**
 * beforeUserSignedIn: email + password (and email-link) sign-ins resolve the
 * account through the Auth record's email; refuse while that email is not the
 * settled one. Other providers (custom tokens from the server's own checked
 * flows, phone) are not email sign-ins and pass through. Fails closed for
 * password sign-ins if the check itself cannot run.
 */
export async function handleBeforeSignIn(event: BlockingEventLike): Promise<void> {
  const provider = event.additionalUserInfo?.providerId ?? event.credential?.providerId ?? '';
  if (provider !== 'password' && provider !== 'emailLink') return;
  const uid = event.data?.uid;
  const email = event.data?.email;
  if (!uid || !email) return;
  let ok: boolean;
  try { ok = await addressMayAuthenticate(uid, email); } catch { throw new HttpsError('unavailable', 'signin-unavailable'); }
  if (ok) return;
  await refuse(uid, 'password');
  throw new HttpsError('permission-denied', 'address-replaced');
}

/**
 * beforeEmailSent: no password-reset or sign-in-link email to an address that
 * is not the settled address of the account it currently resolves to.
 */
export async function handleBeforeEmailSent(event: BlockingEventLike): Promise<void> {
  if (event.emailType !== 'PASSWORD_RESET' && event.emailType !== 'EMAIL_SIGN_IN') return;
  const email = event.additionalUserInfo?.email ?? event.data?.email ?? null;
  if (!email) return;
  let uid: string;
  try {
    uid = event.data?.uid ?? (await getAuth().getUserByEmail(email)).uid;
  } catch (e) {
    if ((e as { code?: string })?.code === 'auth/user-not-found') return; // no account: Firebase sends nothing either
    throw new HttpsError('unavailable', 'email-unavailable');
  }
  let ok: boolean;
  try { ok = await addressMayAuthenticate(uid, email); } catch { throw new HttpsError('unavailable', 'email-unavailable'); }
  if (ok) return;
  await refuse(uid, event.emailType === 'PASSWORD_RESET' ? 'password-reset' : 'email-link');
  throw new HttpsError('permission-denied', 'address-replaced');
}
