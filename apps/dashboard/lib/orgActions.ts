'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { verifySession } from './session';
import { canDo } from './adminPermissions';

// ─── Validation ───────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]{2}$/;
const VALID_STATUSES = ['active', 'suspended', 'disabled'] as const;
const VALID_LANGUAGES = ['en', 'ar', 'fr', 'es', 'de', 'pt'] as const;

function validate(data: FormData): {
  name: string; slug: string; status: string; ownerUid: string;
  smsEnabled: boolean; pointsEnabled: boolean;
  defaultLanguage: string; timezone: string;
} | { error: string } {
  const name   = (data.get('name')   as string | null)?.trim() ?? '';
  const slug   = (data.get('slug')   as string | null)?.trim().toLowerCase() ?? '';
  const status = (data.get('status') as string | null)?.trim() ?? 'active';
  const ownerUid = (data.get('ownerUid') as string | null)?.trim() ?? '';
  const smsEnabled    = data.get('smsEnabled')    === 'true';
  const pointsEnabled = data.get('pointsEnabled') === 'true';
  const defaultLanguage = (data.get('defaultLanguage') as string | null)?.trim() ?? 'en';
  const timezone = (data.get('timezone') as string | null)?.trim() ?? 'UTC';

  if (!name) return { error: 'Name is required.' };
  if (name.length > 120) return { error: 'Name must be 120 characters or less.' };
  if (!slug) return { error: 'Slug is required.' };
  if (!SLUG_RE.test(slug)) return { error: 'Slug must be 2–40 lowercase letters/numbers/hyphens.' };
  if (!(VALID_STATUSES as readonly string[]).includes(status)) {
    return { error: 'Invalid status.' };
  }
  if (!(VALID_LANGUAGES as readonly string[]).includes(defaultLanguage as any)) {
    return { error: 'Invalid default language.' };
  }

  return { name, slug, status, ownerUid, smsEnabled, pointsEnabled, defaultLanguage, timezone };
}

// ─── Write audit log (server-side) ───────────────────────────────────────────

async function writeOrgAudit(
  action: string,
  actorUid: string,
  actorEmail: string | undefined,
  targetId: string,
  meta: Record<string, unknown>,
) {
  try {
    await adminDb.collection('auditLogs').add({
      action,
      actorUid,
      actorEmail:  actorEmail ?? null,
      targetType:  'organization',
      targetId,
      result:      'success',
      metadata:    meta,
      createdAt:   FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }
}

// ─── Create organization ──────────────────────────────────────────────────────

export type OrgActionState = { error?: string; success?: boolean } | null;

export async function createOrganization(
  _prev: OrgActionState,
  data: FormData,
): Promise<OrgActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:organizations')) {
    return { error: 'Permission denied.' };
  }

  const parsed = validate(data);
  if ('error' in parsed) return { error: parsed.error };

  // Slug uniqueness check.
  const existing = await adminDb.collection('organizations')
    .where('slug', '==', parsed.slug).limit(1).get();
  if (!existing.empty) return { error: 'That slug is already taken.' };

  const ref = adminDb.collection('organizations').doc();
  await ref.set({
    name:     parsed.name,
    slug:     parsed.slug,
    status:   parsed.status,
    ownerUid: parsed.ownerUid || null,
    settings: {
      smsEscalationEnabled: parsed.smsEnabled,
      pointsEnabled:        parsed.pointsEnabled,
      defaultLanguage:      parsed.defaultLanguage,
      timezone:             parsed.timezone,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeOrgAudit('organization.created', session.user.uid, session.user.email, ref.id, {
    name: parsed.name, slug: parsed.slug,
  });

  redirect(`/admin/organizations/${ref.id}` as any);
}

// ─── Update organization ──────────────────────────────────────────────────────

export async function updateOrganization(
  orgId: string,
  _prev: OrgActionState,
  data: FormData,
): Promise<OrgActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:organizations')) {
    return { error: 'Permission denied.' };
  }

  const parsed = validate(data);
  if ('error' in parsed) return { error: parsed.error };

  // Slug uniqueness (exclude self).
  const existing = await adminDb.collection('organizations')
    .where('slug', '==', parsed.slug).limit(2).get();
  const taken = existing.docs.filter(d => d.id !== orgId);
  if (taken.length > 0) return { error: 'That slug is already taken.' };

  await adminDb.collection('organizations').doc(orgId).update({
    name:     parsed.name,
    slug:     parsed.slug,
    status:   parsed.status,
    ownerUid: parsed.ownerUid || null,
    'settings.smsEscalationEnabled': parsed.smsEnabled,
    'settings.pointsEnabled':        parsed.pointsEnabled,
    'settings.defaultLanguage':      parsed.defaultLanguage,
    'settings.timezone':             parsed.timezone,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await writeOrgAudit('organization.updated', session.user.uid, session.user.email, orgId, {
    name: parsed.name, slug: parsed.slug, status: parsed.status,
  });

  redirect(`/admin/organizations/${orgId}` as any);
}
