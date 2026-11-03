import { writeSocialActivity } from '../social/activityModel';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue, FieldPath, Timestamp, AggregateField, type Firestore } from 'firebase-admin/firestore';
import { publicNameFrom } from '../lib/displayName';
import { clipId, cleanClipText, pageLimit, decodeClipCursor, encodeClipCursor, millis } from './model';
import { requireClipUid, assertClipMutation, clipsBlocked, assertActiveClipUser, loadClipsConfig, assertClipsEnabled, consumeClipRate } from './access';

export async function publicClipAuthor(db: Firestore, uid: string) {
  const [user, profile] = await db.getAll(db.doc(`users/${uid}`), db.doc(`clipProfiles/${uid}`));
  return { uid, displayName: publicNameFrom(user.data(), uid) ?? '',
    username: typeof user.get('username') === 'string' ? user.get('username') : '',
    photoURL: typeof user.get('photoURL') === 'string' ? user.get('photoURL') : null,
    privateAccount: profile.get('privateAccount') === true };
}
export async function clipProfile(db: Firestore, uid: string, viewerUid: string) {
  if (await clipsBlocked(db, viewerUid, uid)) throw new HttpsError('not-found', 'creator-unavailable');
  const [user, profile, relation] = await db.getAll(db.doc(`users/${uid}`), db.doc(`clipProfiles/${uid}`), db.doc(`clipProfiles/${uid}/followers/${viewerUid}`));
  if (!user.exists || (uid !== viewerUid && (user.get('status') === 'suspended' || user.get('disabled') === true || profile.get('suspended') === true || profile.get('deleting') === true)))
    throw new HttpsError('not-found', 'creator-unavailable');
  const stats = profile.data() ?? {};
  const follower = relation.get('status') === 'accepted';
  const maySeePublic = uid === viewerUid || stats.privateAccount !== true || follower;
  let totals = { clipCount: 0, likeCount: 0 };
  if (maySeePublic) {
    let published = db.collection('clips').where('ownerUid', '==', uid).where('status', '==', 'published');
    if (uid !== viewerUid) published = published.where('audience', 'in', follower ? ['public', 'followers'] : ['public']);
    totals = (await published.aggregate({ clipCount: AggregateField.count(), likeCount: AggregateField.sum('likeCount') }).get()).data();
  }
  return {
    ...(await publicClipAuthor(db, uid)), bio: typeof stats.bio === 'string' ? stats.bio : '',
    followerCount: Math.max(0, Number(stats.followerCount) || 0), followingCount: Math.max(0, Number(stats.followingCount) || 0),
    clipCount: Math.max(0, totals.clipCount), likeCount: Math.max(0, totals.likeCount),
    followStatus: relation.get('status') === 'accepted' ? 'accepted' : relation.get('status') === 'pending' ? 'pending' : 'none',
    isOwner: uid === viewerUid, blocked: false,
  };
}
export const getClipProfile = onCall({ region: 'us-central1' }, async request => {
  const viewer = requireClipUid(request), db = getFirestore();
  assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, viewer);
  return { profile: await clipProfile(db, clipId(request.data?.uid, 'uid'), viewer) };
});
export const updateClipProfile = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid);
  const data = request.data ?? {}; const updates: Record<string, unknown> = {};
  if (data.bio !== undefined) updates.bio = cleanClipText(data.bio, 300, 'bio');
  if (data.privateAccount !== undefined) {
    if (typeof data.privateAccount !== 'boolean') throw new HttpsError('invalid-argument', 'privateAccount-invalid');
    updates.privateAccount = data.privateAccount;
  }
  await db.runTransaction(async tx => {
    await assertActiveClipUser(db, uid, tx);
    tx.set(db.doc(`clipProfiles/${uid}`), { ...updates, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { profile: await clipProfile(db, uid, uid) };
});

/** Mirror the relation and both counts in one transaction. Pending != membership. */
async function changeFollow(db: Firestore, ownerUid: string, followerUid: string,
  command: 'follow' | 'unfollow' | 'accept' | 'decline' | 'remove') {
  const ownerRef = db.doc(`clipProfiles/${ownerUid}`), followerRef = db.doc(`clipProfiles/${followerUid}`);
  const relationRef = ownerRef.collection('followers').doc(followerUid), mirrorRef = followerRef.collection('following').doc(ownerUid);
  return db.runTransaction(async tx => {
    const [owner, follower, relation, blockedA, blockedB, ownerUser, followerUser] = await tx.getAll(ownerRef, followerRef, relationRef,
      db.doc(`users/${ownerUid}/blockedUsers/${followerUid}`), db.doc(`users/${followerUid}/blockedUsers/${ownerUid}`),
      db.doc(`users/${ownerUid}`), db.doc(`users/${followerUid}`));
    if (!ownerUser.exists || !followerUser.exists || ownerUser.get('status') === 'suspended' || followerUser.get('status') === 'suspended'
        || ownerUser.get('disabled') === true || followerUser.get('disabled') === true
        || owner.get('suspended') === true || follower.get('suspended') === true || owner.get('deleting') === true || follower.get('deleting') === true)
      throw new HttpsError('not-found', 'creator-unavailable');
    if (['follow', 'accept'].includes(command) && (blockedA.exists || blockedB.exists)) throw new HttpsError('permission-denied', 'creator-blocked');
    const before = relation.get('status') ?? 'none';
    let status = 'none';
    if (command === 'follow') status = before === 'accepted' || before === 'pending' ? before : owner.get('privateAccount') === true ? 'pending' : 'accepted';
    if (command === 'accept') {
      if (!['pending', 'accepted'].includes(before)) throw new HttpsError('failed-precondition', 'follow-request-not-found');
      status = 'accepted';
    }
    if (status === before) return status;
    const diff = (status === 'accepted' ? 1 : 0) - (before === 'accepted' ? 1 : 0);
    if (command === 'follow') writeSocialActivity(db, tx, ownerUid, { kind: 'follow', actorUid: followerUid });
    if (command === 'accept') writeSocialActivity(db, tx, followerUid, { kind: 'followAccepted', actorUid: ownerUid });
    if (status === 'none') {
      writeSocialActivity(db, tx, ownerUid, { kind: 'follow', actorUid: followerUid }, false);
      writeSocialActivity(db, tx, followerUid, { kind: 'followAccepted', actorUid: ownerUid }, false);
    }
    if (status === 'none') { tx.delete(relationRef); tx.delete(mirrorRef); }
    else {
      const value = { status, createdAt: relation.get('createdAt') ?? FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
      tx.set(relationRef, value); tx.set(mirrorRef, value);
    }
    if (diff) {
      tx.set(ownerRef, { followerCount: Math.max(0, (owner.get('followerCount') ?? 0) + diff), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(followerRef, { followingCount: Math.max(0, (follower.get('followingCount') ?? 0) + diff), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return status;
  });
}
export const followClipCreator = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid);
  const target = clipId(request.data?.uid, 'uid');
  if (target === uid || typeof request.data?.following !== 'boolean') throw new HttpsError('invalid-argument', 'follow-invalid');
  await consumeClipRate(db, uid, 'follow', 30);
  return { status: await changeFollow(db, target, uid, request.data.following ? 'follow' : 'unfollow') };
});
export const respondClipFollowRequest = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid);
  if (typeof request.data?.accept !== 'boolean') throw new HttpsError('invalid-argument', 'accept-invalid');
  await changeFollow(db, uid, clipId(request.data?.uid, 'uid'), request.data.accept ? 'accept' : 'decline'); return { ok: true };
});
export const removeClipFollower = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore(); await assertClipMutation(db, uid);
  await changeFollow(db, uid, clipId(request.data?.uid, 'uid'), 'remove'); return { ok: true };
});
async function listOwnFollowers(request: Parameters<typeof requireClipUid>[0], status: 'pending' | 'accepted') {
  const uid = requireClipUid(request), db = getFirestore(); assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, uid);
  const limit = pageLimit(request.data?.limit), cursor = decodeClipCursor(request.data?.cursor);
  let query = db.collection(`clipProfiles/${uid}/followers`).where('status', '==', status).orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc').limit(limit);
  if (cursor) query = query.startAfter(new Timestamp(cursor[0], cursor[1]), cursor[2]);
  const rows = await query.get();
  const items = [];
  for (const row of rows.docs) {
    const [user, profile] = await db.getAll(db.doc(`users/${row.id}`), db.doc(`clipProfiles/${row.id}`));
    if (!user.exists || user.get('disabled') === true || user.get('status') === 'suspended' || profile.get('suspended') === true || profile.get('deleting') === true || await clipsBlocked(db, uid, row.id)) continue;
    items.push({ ...(await publicClipAuthor(db, row.id)), createdAtMs: millis(row.get('createdAt')) });
  }
  const last = rows.docs[rows.size - 1];
  return { items, nextCursor: rows.size === limit && last ? encodeClipCursor(last.get('createdAt'), last.id) : null };
}
export const listClipFollowRequests = onCall({ region: 'us-central1' }, request => listOwnFollowers(request, 'pending'));
export const listClipFollowers = onCall({ region: 'us-central1' }, request => listOwnFollowers(request, 'accepted'));
