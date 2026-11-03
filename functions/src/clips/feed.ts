import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldPath, Timestamp, type Firestore, type Query, type DocumentSnapshot } from 'firebase-admin/firestore';
import { requireClipUid, assertActiveClipUser, loadClipsConfig, assertClipsEnabled, canViewClip, assertCanViewClip } from './access';
import { clipId, cleanClipText, millis, pageLimit, decodeClipCursor, encodeClipCursor, type ClipDoc } from './model';
import { publicClipAuthor } from './profiles';

export async function serializeClip(db: Firestore, snap: DocumentSnapshot, uid: string) {
  const c = snap.data() as ClipDoc;
  const [liked, saved, follow, author] = await Promise.all([
    db.doc(`clips/${snap.id}/likes/${uid}`).get(), db.doc(`clipProfiles/${uid}/saved/${snap.id}`).get(),
    db.doc(`clipProfiles/${c.ownerUid}/followers/${uid}`).get(), publicClipAuthor(db, c.ownerUid),
  ]);
  return {
    id: snap.id, ownerUid: c.ownerUid, caption: c.caption ?? '', hashtags: c.hashtags ?? [],
    audience: c.audience, groupId: c.groupId ?? null, status: c.status,
    allowComments: c.allowComments === true, allowDownload: c.allowDownload === true,
    durationMs: c.durationMs ?? 0, width: c.width ?? 0, height: c.height ?? 0,
    createdAtMs: millis(c.createdAt), publishedAtMs: millis(c.publishedAt),
    likeCount: Math.max(0, c.likeCount ?? 0), commentCount: Math.max(0, c.commentCount ?? 0),
    viewCount: Math.max(0, c.viewCount ?? 0), shareCount: Math.max(0, c.shareCount ?? 0),
    likedByMe: liked.exists, savedByMe: saved.exists, followStatus: follow.get('status') ?? 'none', author,
    ...(c.ownerUid === uid ? { errorCode: c.errorCode ?? null, moderationReason: c.moderationReason ?? null } : {}),
  };
}
export const getClip = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore();
  assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, uid);
  const row = await db.doc(`clips/${clipId(request.data?.clipId)}`).get();
  if (!row.exists) throw new HttpsError('not-found', 'clip-unavailable');
  await assertCanViewClip(db, row.data() as ClipDoc, uid);
  return { clip: await serializeClip(db, row, uid) };
});

// Timestamp + document-ID cursor always advances through examined documents,
// including empty audience-filtered pages. It never restarts at the newest item.
export const getClipsFeed = onCall({ region: 'us-central1' }, async request => {
  const uid = requireClipUid(request), db = getFirestore();
  assertClipsEnabled(await loadClipsConfig(db)); await assertActiveClipUser(db, uid);
  const data = request.data ?? {}, mode = data.mode ?? 'forYou';
  if (!['forYou', 'following', 'saved', 'profile'].includes(mode)) throw new HttpsError('invalid-argument', 'feed-mode-invalid');
  const limit = pageLimit(data.limit), cursor = decodeClipCursor(data.cursor);
  const search = cleanClipText(data.query ?? '', 100, 'query').toLocaleLowerCase().replace(/^#/, '');
  let query: Query = mode === 'saved' ? db.collection(`clipProfiles/${uid}/saved`) : db.collection('clips');
  if (mode === 'profile') query = query.where('ownerUid', '==', clipId(data.ownerUid ?? uid, 'ownerUid'));
  query = query.orderBy('createdAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
  if (cursor) query = query.startAfter(new Timestamp(cursor[0], cursor[1]), cursor[2]);
  const SCAN = 90, rows = await query.limit(SCAN).get();
  const items: Awaited<ReturnType<typeof serializeClip>>[] = [];
  let lastExamined: DocumentSnapshot | null = null;
  for (const row of rows.docs) {
    lastExamined = row;
    const clip = mode === 'saved' ? await db.doc(`clips/${row.id}`).get() : row;
    if (!clip.exists) continue;
    const c = clip.data() as ClipDoc;
    if (mode !== 'profile' && c.status !== 'published') continue;
    if (mode === 'forYou' && c.audience === 'private') continue;
    if (!(await canViewClip(db, c, uid))) continue;
    if (mode !== 'profile' && mode !== 'saved' && (await db.doc(`clipProfiles/${uid}/hidden/${clip.id}`).get()).exists) continue;
    if (mode === 'following' && (await db.doc(`clipProfiles/${c.ownerUid}/followers/${uid}`).get()).get('status') !== 'accepted') continue;
    const item = await serializeClip(db, clip, uid);
    if (search && ![item.caption, ...item.hashtags, item.author.displayName, item.author.username].some(v => String(v).toLocaleLowerCase().includes(search))) continue;
    items.push(item);
    if (items.length >= limit) break;
  }
  // Discovery combines recency with engagement only within this stable scan
  // window. It is deliberately bounded, not a claim of global ML ranking.
  if (mode === 'forYou' && !search) {
    const score = (c: typeof items[number]) => Math.log1p(c.likeCount + 2 * c.commentCount) - (Date.now() - c.createdAtMs) / 86_400_000;
    items.sort((a, b) => score(b) - score(a));
  }
  const examinedAll = lastExamined?.id === rows.docs[rows.size - 1]?.id;
  return { items, nextCursor: lastExamined && (!examinedAll || rows.size === SCAN)
    ? encodeClipCursor(lastExamined.get('createdAt'), lastExamined.id) : null };
});
