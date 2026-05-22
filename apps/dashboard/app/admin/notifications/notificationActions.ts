'use server';

import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase-admin';
import { verifySession } from '@/lib/session';
import { canDo } from '@/lib/adminPermissions';

export type NotificationActionState = { error?: string; success?: boolean; id?: string } | null;

const AUDIENCE_OPTIONS = ['all', 'organization', 'group'] as const;
type Audience = (typeof AUDIENCE_OPTIONS)[number];

export async function saveDraftNotification(
  _prev: NotificationActionState,
  data: FormData,
): Promise<NotificationActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:notifications')) {
    return { error: 'Permission denied.' };
  }

  const title    = (data.get('title')    as string | null)?.trim() ?? '';
  const body     = (data.get('body')     as string | null)?.trim() ?? '';
  const audience = (data.get('audience') as string | null)?.trim() ?? 'all';

  if (!title) return { error: 'Title is required.' };
  if (title.length > 140) return { error: 'Title must be 140 characters or fewer.' };
  if (!body)  return { error: 'Body is required.' };
  if (body.length > 500) return { error: 'Body must be 500 characters or fewer.' };
  if (!(AUDIENCE_OPTIONS as readonly string[]).includes(audience)) {
    return { error: 'Invalid audience.' };
  }

  const ref = await adminDb.collection('notifications').add({
    title,
    body,
    audience: audience as Audience,
    status:    'draft',
    createdBy: session.user.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await adminDb.collection('auditLogs').add({
      action:     'notification.draft.created',
      actorUid:   session.user.uid,
      actorEmail: session.user.email ?? null,
      targetType: 'notification',
      targetId:   ref.id,
      result:     'success',
      metadata:   { title, audience },
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  return { success: true, id: ref.id };
}
