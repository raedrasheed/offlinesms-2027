'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { verifySession } from './session';
import { isPlatformAdmin } from './adminScope';
import { retentionPolicy, retentionCutoff, validRetentionDays, chatMessagePath } from '../../../functions/src/chats/messageRetentionPolicy';

export type RetentionActionState = { error?: string; success?: boolean } | null;
export async function previewMessageRetention(days: number): Promise<{ count?: number; lowerBound?: boolean; error?: string }> {
  const session = await verifySession(cookies().get('__session')?.value);
  if (session.state !== 'authorized' || !isPlatformAdmin(session)) return { error: 'Platform admin access required.' };
  if (!validRetentionDays(days)) return { error: 'Enter a whole number from 1 to 3650 days.' };
  try {
    const base = adminDb.collectionGroup('messages')
      .where('createdAt', '<=', Timestamp.fromMillis(retentionCutoff(Date.now(), days)))
      .orderBy('createdAt').select('createdAt').limit(500);
    let last: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    let count = 0;
    for (let page = 0; page < 20; page++) {
      const batch = await (last ? base.startAfter(last) : base).get();
      count += batch.docs.filter(d => chatMessagePath(d.ref.path)).length;
      if (batch.size < 500) return { count, lowerBound: false };
      last = batch.docs[batch.docs.length - 1];
    }
    return { count, lowerBound: true };
  } catch { return { error: 'Could not preview deletion. Check the retention index and try again.' }; }
}

export async function updateMessageRetention(_prev: RetentionActionState, form: FormData): Promise<RetentionActionState> {
  const session = await verifySession(cookies().get('__session')?.value);
  if (session.state !== 'authorized' || !isPlatformAdmin(session)) return { error: 'Platform admin access required.' };
  const days = Number(form.get('messageRetentionDays'));
  const enabled = form.get('messageRetentionEnabled') === 'true';
  if (!validRetentionDays(days)) return { error: 'Enter a whole number from 1 to 3650 days.' };
  const ref = adminDb.doc('systemSettings/general');
  try {
    const result = await adminDb.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const old = retentionPolicy(snap.data());
      if (enabled && (!old.enabled || days < old.days) && form.get('confirmedDays') !== String(days)) {
        return { error: 'Preview and confirm the messages affected before enabling or shortening retention.' };
      }
      tx.set(ref, {
        messageRetentionDays: days, messageRetentionEnabled: enabled,
        retentionUpdatedAt: FieldValue.serverTimestamp(), retentionUpdatedBy: session.user.uid,
      }, { merge: true });
      tx.create(adminDb.collection('auditLogs').doc(), {
        action: 'message.retention.updated', actorUid: session.user.uid,
        targetType: 'system-settings', targetId: 'general', result: 'success',
        metadata: { before: old, after: { days, enabled } }, createdAt: FieldValue.serverTimestamp(),
      });
      return { success: true };
    });
    if (result.success) revalidatePath('/admin/settings');
    return result;
  } catch { return { error: 'Could not save retention settings. Please try again.' }; }
}
