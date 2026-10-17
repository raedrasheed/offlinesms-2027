import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { contactSearchDocument, PUBLIC_CONTACT_FIELDS } from './contactSearch';

/** Read the current profile in the transaction: late events/backfills cannot restore stale names. */
export async function refreshAppContactSearch(uid: string, db: Firestore = getFirestore()): Promise<void> {
  await db.runTransaction(async tx => {
    const [profile] = await tx.getAll(db.doc(`users/${uid}`), {fieldMask:PUBLIC_CONTACT_FIELDS});
    const value=contactSearchDocument(uid,profile.exists ? profile.data() : undefined);
    const target=db.doc(`appContactSearch/${uid}`);
    if (value) tx.set(target,value); else tx.delete(target);
  });
}

export const syncAppContactSearch = onDocumentWritten({document:'users/{uid}',region:'us-central1',retry:true}, async event => {
  const uid=event.params.uid;
  const before=contactSearchDocument(uid,event.data?.before.data());
  const after=contactSearchDocument(uid,event.data?.after.data());
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await refreshAppContactSearch(uid);
});
