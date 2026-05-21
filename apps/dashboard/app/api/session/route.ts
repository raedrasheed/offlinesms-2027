// Session cookie endpoint.
//
//   POST /api/session   — body: { idToken } — sets the `__session` cookie.
//   DELETE /api/session — clears the cookie.
//
// The session cookie is HTTP-only and verified server-side by
// `lib/session.verifySession()` on every `/admin/*` request.

import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = '__session';

export async function POST(request: Request) {
  let body: { idToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const idToken = body.idToken;
  if (!idToken || typeof idToken !== 'string') {
    return NextResponse.json({ error: 'missing_id_token' }, { status: 400 });
  }

  try {
    // Re-verify the ID token so we don't trust the client blindly.
    await adminAuth.verifyIdToken(idToken, true);
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: FIVE_DAYS_MS,
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: FIVE_DAYS_MS / 1000,
    });
    return res;
  } catch {
    return NextResponse.json({ error: 'invalid_id_token' }, { status: 401 });
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
