import { NextResponse } from 'next/server';
import { adminAuth } from './firebase-admin';
import type { DecodedIdToken } from 'firebase-admin/auth';

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

function responseWithCookie(value: string, maxAge: number) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('__session', value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
  return response;
}

export async function exchangeDashboardSession(
  request: Request,
  accessError: (claims: DecodedIdToken) => string | null,
) {
  let body: { idToken?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const idToken = body?.idToken;
  if (!idToken || typeof idToken !== 'string') {
    return NextResponse.json({ error: 'missing_id_token' }, { status: 400 });
  }

  try {
    const claims = await adminAuth.verifyIdToken(idToken, true);
    const error = accessError(claims);
    if (error) return NextResponse.json({ error }, { status: 403 });

    const cookie = await adminAuth.createSessionCookie(idToken, { expiresIn: FIVE_DAYS_MS });
    return responseWithCookie(cookie, FIVE_DAYS_MS / 1000);
  } catch {
    return NextResponse.json({ error: 'invalid_id_token' }, { status: 401 });
  }
}

export function clearDashboardSession() {
  return responseWithCookie('', 0);
}
