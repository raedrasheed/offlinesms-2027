import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore } from 'firebase-admin/firestore';
import { isStatusAudienceMember, type StatusAudienceFields } from './statusLogic';

export type StatusRecord = StatusAudienceFields & {
  authorId?: string; expiresAt?: { toMillis(): number }; body?: string;
};

export function statusIdInput(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 200 || value.includes('/')) {
    throw new HttpsError('invalid-argument', 'statusId-required');
  }
  return value;
}

/** Every server interaction rechecks expiry, audience, accounts and both blocks. */
export async function assertStatusAccess(db: Firestore, uid: string, status: StatusRecord, ownerOnly = false) {
  const owner = status.authorId;
  if (!owner || (ownerOnly && owner !== uid)) throw new HttpsError('permission-denied', 'status-owner-required');
  if ((status.expiresAt?.toMillis?.() ?? 0) <= Date.now()) throw new HttpsError('failed-precondition', 'status-expired');
  if (owner !== uid && !isStatusAudienceMember(status, uid)) throw new HttpsError('permission-denied', 'not-in-audience');
  const refs = [db.doc(`users/${uid}`), db.doc(`users/${owner}`)];
  if (owner !== uid) refs.push(db.doc(`users/${uid}/blockedUsers/${owner}`), db.doc(`users/${owner}/blockedUsers/${uid}`));
  const docs = await db.getAll(...refs);
  if (docs.slice(0, 2).some(s => !s.exists || (s.get('status') ?? 'active') !== 'active' || s.get('disabled') === true)) {
    throw new HttpsError('permission-denied', 'status-account-unavailable');
  }
  if (docs.slice(2).some(s => s.exists)) throw new HttpsError('permission-denied', 'status-unavailable');
}
