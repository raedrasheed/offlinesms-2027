'use server';

import { cookies } from 'next/headers';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { verifySession } from './session';
import { canDo } from './adminPermissions';

export type SettingsActionState = { error?: string; success?: boolean } | null;

const VALID_LANGUAGES = ['en', 'ar', 'fr', 'es', 'de', 'pt'] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function updateSystemSettings(
  _prev: SettingsActionState,
  data: FormData,
): Promise<SettingsActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:settings')) {
    return { error: 'Permission denied.' };
  }

  const appName             = (data.get('appName')             as string | null)?.trim() ?? '';
  const supportEmail        = (data.get('supportEmail')        as string | null)?.trim() ?? '';
  const defaultLanguage     = (data.get('defaultLanguage')     as string | null)?.trim() ?? 'en';
  const defaultTimezone     = (data.get('defaultTimezone')     as string | null)?.trim() ?? 'UTC';
  // Toggle posts a hidden "false" + a checkbox "true" under the same name;
  // read all values so a checked box (present "true") registers correctly.
  const smsEscalationEnabled = data.getAll('smsEscalationEnabled').includes('true');
  const pointsEnabled        = data.getAll('pointsEnabled').includes('true');
  const emailSignInEnabled   = data.getAll('emailSignInEnabled').includes('true');

  if (!appName)                                           return { error: 'App name is required.' };
  if (appName.length > 60)                               return { error: 'App name must be 60 characters or less.' };
  if (supportEmail && !EMAIL_RE.test(supportEmail))      return { error: 'Invalid support email address.' };
  if (!(VALID_LANGUAGES as readonly string[]).includes(defaultLanguage)) {
    return { error: 'Invalid default language.' };
  }
  if (!defaultTimezone)                                  return { error: 'Default timezone is required.' };
  if (defaultTimezone.length > 60)                       return { error: 'Timezone value too long.' };

  await adminDb.collection('systemSettings').doc('general').set({
    appName,
    supportEmail,
    defaultLanguage,
    defaultTimezone,
    smsEscalationEnabled,
    pointsEnabled,
    emailSignInEnabled,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: session.user.uid,
  }, { merge: true });

  try {
    await adminDb.collection('auditLogs').add({
      action:     'system.settings.updated',
      actorUid:   session.user.uid,
      actorEmail: session.user.email ?? null,
      targetType: 'system-settings',
      targetId:   'general',
      result:     'success',
      metadata:   {
        appName,
        defaultLanguage,
        defaultTimezone,
        smsEscalationEnabled,
        pointsEnabled,
        emailSignInEnabled,
      },
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }

  return { success: true };
}
