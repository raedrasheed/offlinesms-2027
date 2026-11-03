import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

export function activeSocialAccount(user: Record<string, any> | undefined, profile: Record<string, any> | undefined): boolean {
  return !!user && (user.status ?? 'active') === 'active' && user.disabled !== true && user.deletedAccount !== true
    && profile?.deleting !== true && profile?.deletedAccount !== true;
}
export async function assertSocialUser(db: Firestore, uid: string, tx?: Transaction): Promise<void> {
  const [user, profile] = await (tx ?? db).getAll(db.doc(`users/${uid}`), db.doc(`clipProfiles/${uid}`));
  if (!activeSocialAccount(user.data(), profile.data())) throw new HttpsError('permission-denied', 'account-unavailable');
}
