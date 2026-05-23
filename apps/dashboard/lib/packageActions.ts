'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin';
import { verifySession } from './session';
import { canDo } from './adminPermissions';

export type PackageActionState = { error?: string; success?: boolean } | null;

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(data: FormData): {
  name: string; points: number; bonusPoints: number;
  price: number; currency: string; status: string; sortOrder: number;
} | { error: string } {
  const name       = (data.get('name')       as string | null)?.trim() ?? '';
  const pointsRaw  = (data.get('points')     as string | null) ?? '';
  const bonusRaw   = (data.get('bonusPoints')as string | null) ?? '0';
  const priceRaw   = (data.get('price')      as string | null) ?? '0';
  const currency   = (data.get('currency')   as string | null)?.trim().toUpperCase() ?? '';
  const status     = (data.get('status')     as string | null)?.trim() ?? 'active';
  const orderRaw   = (data.get('sortOrder')  as string | null) ?? '0';

  if (!name)         return { error: 'Name is required.' };
  if (name.length > 80) return { error: 'Name must be 80 characters or less.' };

  const points      = parseInt(pointsRaw,  10);
  const bonusPoints = parseInt(bonusRaw,   10);
  const price       = parseFloat(priceRaw);
  const sortOrder   = parseInt(orderRaw,   10);

  if (isNaN(points)      || points      <= 0)  return { error: 'Points must be a positive integer.' };
  if (isNaN(bonusPoints) || bonusPoints <  0)  return { error: 'Bonus points must be 0 or greater.' };
  if (isNaN(price)       || price       <  0)  return { error: 'Price must be 0 or greater.' };
  if (!currency)                               return { error: 'Currency is required.' };
  if (currency.length > 10)                    return { error: 'Currency code too long.' };
  if (!['active', 'disabled'].includes(status)) return { error: 'Invalid status.' };
  if (isNaN(sortOrder))                        return { error: 'Sort order must be a number.' };

  return { name, points, bonusPoints, price, currency, status, sortOrder };
}

async function writePackageAudit(action: string, actorUid: string, actorEmail: string | undefined, targetId: string, meta: Record<string, unknown>) {
  try {
    await adminDb.collection('auditLogs').add({
      action,
      actorUid,
      actorEmail:  actorEmail ?? null,
      targetType:  'points-package',
      targetId,
      result:      'success',
      metadata:    meta,
      createdAt:   FieldValue.serverTimestamp(),
    });
  } catch { /* soft-fail */ }
}

// ─── Create package ───────────────────────────────────────────────────────────

export async function createPointsPackage(
  _prev: PackageActionState,
  data: FormData,
): Promise<PackageActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:packages')) {
    return { error: 'Permission denied.' };
  }

  const parsed = validate(data);
  if ('error' in parsed) return { error: parsed.error };

  const ref = adminDb.collection('pointsPackages').doc();
  await ref.set({
    name:        parsed.name,
    points:      parsed.points,
    bonusPoints: parsed.bonusPoints,
    price:       parsed.price,
    currency:    parsed.currency,
    status:      parsed.status,
    sortOrder:   parsed.sortOrder,
    createdAt:   FieldValue.serverTimestamp(),
    updatedAt:   FieldValue.serverTimestamp(),
  });

  await writePackageAudit('points.package.created', session.user.uid, session.user.email, ref.id, {
    name: parsed.name, points: parsed.points, price: parsed.price,
  });

  redirect('/admin/points/packages' as any);
}

// ─── Update package ───────────────────────────────────────────────────────────

export async function updatePointsPackage(
  packageId: string,
  _prev: PackageActionState,
  data: FormData,
): Promise<PackageActionState> {
  const cookie = cookies().get('__session')?.value;
  const session = await verifySession(cookie);
  if (session.state !== 'authorized' || !canDo(session.role, 'manage:packages')) {
    return { error: 'Permission denied.' };
  }

  const parsed = validate(data);
  if ('error' in parsed) return { error: parsed.error };

  const existing = await adminDb.collection('pointsPackages').doc(packageId).get();
  if (!existing.exists) return { error: 'Package not found.' };

  const prevStatus = (existing.data()?.status as string) ?? 'active';

  await adminDb.collection('pointsPackages').doc(packageId).update({
    name:        parsed.name,
    points:      parsed.points,
    bonusPoints: parsed.bonusPoints,
    price:       parsed.price,
    currency:    parsed.currency,
    status:      parsed.status,
    sortOrder:   parsed.sortOrder,
    updatedAt:   FieldValue.serverTimestamp(),
  });

  let action = 'points.package.updated';
  if (prevStatus !== parsed.status) {
    action = parsed.status === 'active' ? 'points.package.enabled' : 'points.package.disabled';
  }

  await writePackageAudit(action, session.user.uid, session.user.email, packageId, {
    name: parsed.name, points: parsed.points, status: parsed.status,
  });

  redirect('/admin/points/packages' as any);
}
