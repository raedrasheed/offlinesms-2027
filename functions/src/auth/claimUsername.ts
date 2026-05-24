// Claim (or change) a username, transactionally.
//
// The only path that writes to `usernames/{lowercase}`. Validation rules are
// mirrored on the client (apps/mobile/src/lib/username.ts) — keep them in
// sync. On success this also patches the caller's `users/{uid}` doc with
// the allowed profile fields and flips `profileCompleted` to true.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { writeAuditLog } from '../lib/auditLog';

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;

const RESERVED = new Set([
  'admin', 'admins', 'administrator',
  'support', 'help', 'helpdesk',
  'system', 'sys',
  'offlinesms', 'offline_sms', 'offline.sms',
  'official', 'staff', 'mod', 'moderator',
  'root', 'superuser',
  'null', 'undefined', 'nil',
  'me', 'you', 'self',
  'test', 'demo',
]);

function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function validateUsernameFormat(u: string): void {
  if (u.length < USERNAME_MIN) throw new HttpsError('invalid-argument', 'username-too-short');
  if (u.length > USERNAME_MAX) throw new HttpsError('invalid-argument', 'username-too-long');
  if (!/^[a-z0-9._]+$/.test(u)) throw new HttpsError('invalid-argument', 'username-invalid-chars');
  if (/^[._]/.test(u) || /[._]$/.test(u)) throw new HttpsError('invalid-argument', 'username-edge-punct');
  if (/[._]{2,}/.test(u)) throw new HttpsError('invalid-argument', 'username-consecutive-punct');
  if (RESERVED.has(u)) throw new HttpsError('invalid-argument', 'username-reserved');
}

function validateDisplayName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new HttpsError('invalid-argument', 'display-name-required');
  if (trimmed.length > 60) throw new HttpsError('invalid-argument', 'display-name-too-long');
  return trimmed;
}

function validateAbout(about: unknown): string | null {
  if (about == null) return null;
  if (typeof about !== 'string') throw new HttpsError('invalid-argument', 'about-must-be-string');
  const trimmed = about.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 140) throw new HttpsError('invalid-argument', 'about-too-long');
  return trimmed;
}

export const claimUsername = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'sign-in-required');

  const data = (request.data ?? {}) as {
    username?: unknown;
    displayName?: unknown;
    about?: unknown;
  };

  if (typeof data.username !== 'string') throw new HttpsError('invalid-argument', 'username-required');
  if (typeof data.displayName !== 'string') throw new HttpsError('invalid-argument', 'display-name-required');

  const usernameLower = normalizeUsername(data.username);
  validateUsernameFormat(usernameLower);
  const displayName = validateDisplayName(data.displayName);
  const about = validateAbout(data.about);

  const db = getFirestore();
  const userRef     = db.collection('users').doc(uid);
  const newNameRef  = db.collection('usernames').doc(usernameLower);

  let releasedPrevious: string | null = null;

  await db.runTransaction(async (tx) => {
    const [userSnap, newNameSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(newNameRef),
    ]);

    // Username is taken by someone else.
    if (newNameSnap.exists && newNameSnap.data()?.uid !== uid) {
      throw new HttpsError('already-exists', 'username-taken');
    }

    // Release prior username if the caller is renaming.
    const previousLower = userSnap.exists ? (userSnap.data()?.usernameLower as string | undefined) : undefined;
    if (previousLower && previousLower !== usernameLower) {
      const prevRef = db.collection('usernames').doc(previousLower);
      const prevSnap = await tx.get(prevRef);
      if (prevSnap.exists && prevSnap.data()?.uid === uid) {
        tx.delete(prevRef);
        releasedPrevious = previousLower;
      }
    }

    tx.set(newNameRef, {
      uid,
      username: usernameLower,
      claimedAt: FieldValue.serverTimestamp(),
    });

    tx.set(userRef, {
      displayName,
      username: usernameLower,
      usernameLower,
      about,
      profileCompleted: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await writeAuditLog({
    action: releasedPrevious ? 'auth.username.changed' : 'auth.username.claimed',
    actor:  { uid },
    target: { type: 'user', id: uid },
    result: 'success',
    metadata: {
      usernameLower,
      releasedPrevious,
    },
  });

  return { uid, username: usernameLower, usernameLower };
});
