import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { clipsConfig, type ClipDoc, type ClipsConfig } from './model';

export function requireClipUid(request: CallableRequest<any>): string {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'sign-in-required');
  return request.auth.uid;
}
/** Organization/support/finance roles never become platform content admins. */
export function isPlatformClipAdmin(claims: Record<string, unknown> = {}): boolean {
  return claims.role === 'super_admin' || claims.role === 'legacy_admin'
    || (claims.admin === true && !claims.role && !claims.organizationId && !(Array.isArray(claims.roles) && claims.roles.length));
}
export async function loadClipsConfig(db: Firestore): Promise<ClipsConfig> {
  const raw = (await db.doc('systemSettings/clips').get()).data() ?? {};
  if (!raw.supportEmail) raw.supportEmail = (await db.doc('systemSettings/general').get()).get('supportEmail') ?? '';
  return clipsConfig(raw);
}
export function assertClipsEnabled(config: ClipsConfig): void {
  if (!config.enabled) throw new HttpsError('failed-precondition', 'clips-disabled');
}
export async function assertActiveClipUser(db: Firestore, uid: string, tx?: Transaction): Promise<void> {
  const [user, profile] = await (tx ?? db).getAll(db.doc(`users/${uid}`), db.doc(`clipProfiles/${uid}`));
  if (!user.exists || user.get('status') === 'suspended' || user.get('disabled') === true)
    throw new HttpsError('permission-denied', 'account-unavailable');
  if (profile.get('suspended') === true || profile.get('deleting') === true) throw new HttpsError('permission-denied', 'clips-account-suspended');
}
export async function clipsBlocked(db: Firestore, a: string, b: string, tx?: Transaction): Promise<boolean> {
  if (a === b) return false;
  const rows = await (tx ?? db).getAll(db.doc(`users/${a}/blockedUsers/${b}`), db.doc(`users/${b}/blockedUsers/${a}`));
  return rows.some(s => s.exists);
}
export async function isClipGroupMember(db: Firestore, groupId: string, uid: string, tx?: Transaction): Promise<boolean> {
  const [group, member] = await (tx ?? db).getAll(db.doc(`conversations/${groupId}`), db.doc(`conversations/${groupId}/members/${uid}`));
  const roster = group.get('participantUids') ?? group.get('memberIds') ?? [];
  return group.exists && group.get('type') === 'group' && group.get('status') !== 'disabled'
    && Array.isArray(roster) && roster.includes(uid) && member.exists && (member.get('status') ?? 'active') === 'active';
}
export async function assertClipGroupMember(db: Firestore, groupId: string, uid: string, tx?: Transaction): Promise<void> {
  if (!(await isClipGroupMember(db, groupId, uid, tx))) throw new HttpsError('permission-denied', 'clip-group-membership-required');
}
export async function canViewClip(db: Firestore, clip: ClipDoc, uid: string, admin = false, tx?: Transaction): Promise<boolean> {
  if (!clip.ownerUid || clip.status === 'removed') return false;
  if (clip.status === 'suspended') return false;
  if (admin) return true;
  // Mutation transactions read the actor tombstone too: a concurrent account
  // erasure must conflict/retry before any interaction can be recreated.
  if (tx) await assertActiveClipUser(db, uid, tx);
  const [owner, profile, follow] = await (tx ?? db).getAll(db.doc(`users/${clip.ownerUid}`),
    db.doc(`clipProfiles/${clip.ownerUid}`), db.doc(`clipProfiles/${clip.ownerUid}/followers/${uid}`));
  if (!owner.exists || owner.get('status') === 'suspended' || owner.get('disabled') === true || profile.get('suspended') === true || profile.get('deleting') === true) return false;
  if (clip.ownerUid === uid) return true;
  if (clip.status !== 'published' || await clipsBlocked(db, uid, clip.ownerUid, tx)) return false;
  if (profile.get('privateAccount') === true && follow.get('status') !== 'accepted') return false;
  if (clip.audience === 'private') return false;
  if (clip.audience === 'public') return true;
  if (clip.audience === 'followers') return follow.get('status') === 'accepted';
  if (clip.audience === 'group' && typeof clip.groupId === 'string')
    return isClipGroupMember(db, clip.groupId, uid, tx);
  return false;
}
export async function assertCanViewClip(db: Firestore, clip: ClipDoc, uid: string, admin = false, tx?: Transaction): Promise<void> {
  if (!(await canViewClip(db, clip, uid, admin, tx))) throw new HttpsError('not-found', 'clip-unavailable');
}
export async function assertClipsTerms(db: Firestore, uid: string, config?: ClipsConfig): Promise<void> {
  const current = config ?? await loadClipsConfig(db);
  if ((await db.doc(`clipProfiles/${uid}`).get()).get('termsVersion') !== current.termsVersion)
    throw new HttpsError('failed-precondition', 'clips-terms-required');
}
/** Rolling one-minute server bucket, transactionally incremented for mutations. */
export async function consumeClipRate(db: Firestore, uid: string, action: string, max: number): Promise<void> {
  const ref = db.doc(`clipProfiles/${uid}/rateLimits/${action}`);
  await db.runTransaction(async tx => {
    await assertActiveClipUser(db, uid, tx);
    const row = await tx.get(ref); const now = Date.now();
    const count = now - (row.get('windowStartMs') ?? 0) < 60_000 ? row.get('count') ?? 0 : 0;
    if (count >= max) throw new HttpsError('resource-exhausted', 'clips-rate-limited');
    tx.set(ref, { count: count + 1, windowStartMs: count ? row.get('windowStartMs') : now, updatedAt: FieldValue.serverTimestamp() });
  });
}
export async function assertClipMutation(db: Firestore, uid: string): Promise<ClipsConfig> {
  const config = await loadClipsConfig(db); assertClipsEnabled(config);
  await assertActiveClipUser(db, uid); await assertClipsTerms(db, uid, config); return config;
}
