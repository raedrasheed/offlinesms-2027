// Blocking direct-chat peers.
//
// Blocks are stored privately at users/{myUid}/blockedUsers/{peerUid} (the
// parent user doc is world-readable, so the block list cannot be a field).
// Sending to/from a blocked peer is rejected server-side in the message
// callables (see functions/src/chats/blockGuard.ts); this module is the
// client's read/write surface for a user's own block list.

import {
  collection, doc, deleteDoc, onSnapshot, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { db } from './firebase';

/** Block a peer (idempotent). */
export async function blockUser(myUid: string, peerUid: string): Promise<void> {
  await setDoc(doc(db, 'users', myUid, 'blockedUsers', peerUid), {
    createdAt: serverTimestamp(),
  });
}

/** Unblock a peer (idempotent). */
export async function unblockUser(myUid: string, peerUid: string): Promise<void> {
  await deleteDoc(doc(db, 'users', myUid, 'blockedUsers', peerUid));
}

/** Subscribe to the set of uids the current user has blocked. */
export function subscribeBlockedUsers(
  myUid: string | undefined,
  cb: (blocked: Set<string>) => void,
): () => void {
  if (!myUid) { cb(new Set()); return () => {}; }
  return onSnapshot(
    collection(db, 'users', myUid, 'blockedUsers'),
    snap => cb(new Set(snap.docs.map(d => d.id))),
    () => cb(new Set()),
  );
}

/** Subscribe to whether the current user has blocked one specific peer. */
export function subscribeIsBlocked(
  myUid: string | undefined,
  peerUid: string | null | undefined,
  cb: (blocked: boolean) => void,
): () => void {
  if (!myUid || !peerUid) { cb(false); return () => {}; }
  return onSnapshot(
    doc(db, 'users', myUid, 'blockedUsers', peerUid),
    snap => cb(snap.exists()),
    () => cb(false),
  );
}
