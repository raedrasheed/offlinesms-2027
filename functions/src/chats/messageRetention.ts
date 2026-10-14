import { randomUUID } from 'node:crypto';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore, Timestamp, FieldValue, type Firestore, type DocumentReference } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { chatMessagePath, ownedMediaPrefix, retentionPolicy, retentionCutoff } from './messageRetentionPolicy';

const JOBS = 'messageRetentionJobs';
const PAGE = 100;
export interface RetentionDeps { deleteMedia(prefix: string): Promise<void>; now(): number }
const productionDeps: RetentionDeps = {
  deleteMedia: async prefix => { await getStorage().bucket().deleteFiles({ prefix }); },
  now: Date.now,
};

/** Durable journal survives failure between Storage, child-doc and parent deletion. */
async function finishJob(db: Firestore, jobRef: DocumentReference, deps: RetentionDeps): Promise<boolean> {
  const job = (await jobRef.get()).data();
  if (!job || !chatMessagePath(job.messagePath)) return false;
  const ref = db.doc(job.messagePath);
  if (job.storagePrefix) await deps.deleteMedia(job.storagePrefix);
  // No deletedForEveryone flag: already-downloaded phone history remains intact.
  await db.recursiveDelete(ref);
  const convoRef = ref.parent.parent!;
  await db.runTransaction(async tx => {
    const convo = await tx.get(convoRef);
    const [expiredStates, unreadStates] = await Promise.all([
      tx.get(convoRef.collection('userState').where('lastMessageAt', '<=', Timestamp.fromMillis(job.cutoffMs))),
      tx.get(convoRef.collection('userState').where('unreadCount', '>', 0)),
    ]);
    const states = new Map([...expiredStates.docs, ...unreadStates.docs].map(s => [s.id, s]));
    const patch: Record<string, unknown> = {};
    if (convo.get('lastMessage.messageId') === ref.id) {
      patch.lastMessage = null; patch.lastMessageText = ''; patch.lastSenderId = null;
    }
    if (convo.get('pinnedMessage.messageId') === ref.id) patch.pinnedMessage = null;
    if (convo.exists && Object.keys(patch).length) tx.update(convoRef, { ...patch, updatedAt: FieldValue.serverTimestamp() });
    for (const state of states.values()) {
      const at = state.get('lastMessageAt')?.toMillis?.();
      if (typeof at === 'number' && at <= job.cutoffMs) {
        tx.update(state.ref, { lastMessagePreview: '', unreadCount: 0, updatedAt: FieldValue.serverTimestamp() });
      } else if (job.senderUid && state.id !== job.senderUid && (state.get('lastReadAt')?.toMillis?.() ?? 0) < job.messageCreatedAtMs) {
        // Journal removal and decrement commit together: retries cannot count
        // the same expired unread twice, even alongside a newly arriving message.
        tx.update(state.ref, { unreadCount: Math.max(0, (state.get('unreadCount') ?? 0) - 1), updatedAt: FieldValue.serverTimestamp() });
      }
    }
    tx.delete(jobRef);
  });
  return true;
}

/** Exported core for emulator tests; never runs without an enabled, valid policy. */
export async function runMessageRetention(db: Firestore, deps = productionDeps, maxPages = 8) {
  const settingsRef = db.doc('systemSettings/general');
  const initial = retentionPolicy((await settingsRef.get()).data());
  if (!initial.enabled) return { deleted: 0, failed: 0, paused: true };
  const leaseRef = db.doc('systemJobs/messageRetention');
  const owner = randomUUID();
  const acquired = await db.runTransaction(async tx => {
    const lease = await tx.get(leaseRef);
    if ((lease.get('leaseUntil') ?? 0) > deps.now()) return false;
    tx.set(leaseRef, { owner, leaseUntil: deps.now() + 15 * 60_000 }, { merge: true });
    return true;
  });
  if (!acquired) return { deleted: 0, failed: 0, busy: true };
  let deleted = 0, failed = 0;
  const started = deps.now();
  const processed = new Set<string>();
  try {
    // Resume work already admitted under an earlier policy before finding more.
    const pending = await db.collection(JOBS).orderBy('createdAt').limit(PAGE).get();
    for (const job of pending.docs) {
      processed.add(job.id);
      try { if (await finishJob(db, job.ref, deps)) deleted++; } catch { failed++; }
    }
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    for (let page = 0; page < maxPages && deps.now() - started < 420_000; page++) {
      const policy = retentionPolicy((await settingsRef.get()).data());
      if (!policy.enabled) break;
      const cutoffMs = retentionCutoff(deps.now(), policy.days);
      let query = db.collectionGroup('messages').where('createdAt', '<=', Timestamp.fromMillis(cutoffMs)).orderBy('createdAt').limit(PAGE);
      if (last) query = query.startAfter(last);
      const candidates = await query.get();
      if (candidates.empty) break;
      last = candidates.docs[candidates.docs.length - 1];
      for (const candidate of candidates.docs) {
        if (!chatMessagePath(candidate.ref.path)) continue;
        const jobRef = db.collection(JOBS).doc(Buffer.from(candidate.ref.path).toString('base64url'));
        if (processed.has(jobRef.id)) continue;
        processed.add(jobRef.id);
        try {
          const admitted = await db.runTransaction(async tx => {
            const [settings, msg, job] = await Promise.all([tx.get(settingsRef), tx.get(candidate.ref), tx.get(jobRef)]);
            if (job.exists) return true;
            const current = retentionPolicy(settings.data());
            const at = msg.get('createdAt')?.toMillis?.();
            if (!current.enabled || !msg.exists || typeof at !== 'number' || at > retentionCutoff(deps.now(), current.days)) return false;
            tx.create(jobRef, {
              messageCreatedAtMs: at, senderUid: msg.get('senderUid') ?? msg.get('senderId') ?? null,
              messagePath: candidate.ref.path, storagePrefix: ownedMediaPrefix(candidate.ref.path, msg.data()!),
              cutoffMs: retentionCutoff(deps.now(), current.days), createdAt: FieldValue.serverTimestamp(),
            });
            tx.update(candidate.ref, { retentionDeleting: true });
            return true;
          });
          if (admitted && await finishJob(db, jobRef, deps)) deleted++;
        } catch { failed++; }
      }
      if (candidates.size < PAGE) break;
    }
    return { deleted, failed, paused: false };
  } finally {
    await db.runTransaction(async tx => {
      const lease = await tx.get(leaseRef);
      if (lease.get('owner') !== owner) return;
      tx.set(leaseRef, {
        leaseUntil: 0, lastRunAt: FieldValue.serverTimestamp(), deleted, failed,
        durationMs: deps.now() - started,
      }, { merge: true });
    });
  }
}

export const purgeRetainedMessages = onSchedule({
  schedule: 'every 15 minutes', timeZone: 'UTC', timeoutSeconds: 540, maxInstances: 1,
}, async () => { console.info('message-retention', await runMessageRetention(getFirestore())); });
