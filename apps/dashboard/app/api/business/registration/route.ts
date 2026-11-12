import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';
import {
  getOrganizationRegistrationStatus, hasExistingAdminAccess, normalizeRegistrationName, submitOrganizationRegistration,
} from '@/lib/orgRegistration';
import { isRecipientGroupId } from '@/lib/recipientGroupValidation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function fail(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  let body: { idToken?: unknown; name?: unknown } | null;
  try { body = await request.json(); } catch { return fail('invalid_request', 400); }
  if (!body || typeof body.idToken !== 'string' || !body.idToken) return fail('missing_id_token', 400);

  let claims;
  try { claims = await adminAuth.verifyIdToken(body.idToken, true); } catch { return fail('invalid_id_token', 401); }
  if (!claims.email_verified || !claims.email) return fail('email_not_verified', 403);
  if (!isRecipientGroupId(claims.uid)) return fail('invalid_id_token', 401);
  const email = claims.email.trim().toLowerCase();

  try {
    if (body.name === undefined || hasExistingAdminAccess(claims, email)) {
      const current = await getOrganizationRegistrationStatus(claims.uid, email);
      if (current) return NextResponse.json(current);
      return body.name === undefined ? fail('registration_not_found', 404) : fail('account_already_has_admin_access', 403);
    }

    const name = normalizeRegistrationName(body.name);
    if (!name) return fail('invalid_organization_name', 400);
    const result = await submitOrganizationRegistration(claims.uid, email, name);
    return 'error' in result ? fail(result.error, 409) : NextResponse.json(result);
  } catch {
    return fail('registration_unavailable', 500);
  }
}
