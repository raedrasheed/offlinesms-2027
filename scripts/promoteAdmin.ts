// scripts/promoteAdmin.ts
//
// Promote a Firebase Auth user to OfflineSMS admin by email.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//     npm run promote:admin -- user@example.com
//
// This is a *bootstrap* helper. Long-term admin management belongs in
// the dashboard's Roles module (Phase 18). The script:
//
//   1. Loads service-account credentials from GOOGLE_APPLICATION_CREDENTIALS.
//   2. Looks up the user by email.
//   3. Sets two custom claims:
//        admin: true              (legacy gate; still consulted by Phase 1's guard)
//        role:  'super_admin'     (forward-compat — matches Phase 18 role list)
//      while preserving any existing claims.
//   4. Prints the uid and the new claim payload.
//
// It does not print the service-account file path or contents, only
// the email + uid pair, and refuses to run without an explicit email.

import { cert, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

function fatal(msg: string): never {
  console.error(`promoteAdmin: ${msg}`);
  process.exit(1);
}

function loadCredential() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    try {
      return cert(JSON.parse(readFileSync(credPath, 'utf-8')));
    } catch (e) {
      fatal(`could not read service account at GOOGLE_APPLICATION_CREDENTIALS: ${(e as Error).message}`);
    }
  }
  // Fall back to ADC when running inside a Google environment.
  return applicationDefault();
}

async function main() {
  const email = process.argv[2]?.trim();
  if (!email) {
    fatal('usage: npm run promote:admin -- <email>');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fatal(`invalid email: ${email}`);
  }

  initializeApp({ credential: loadCredential() });

  const auth = getAuth();
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (e) {
    const code = (e as { code?: string })?.code ?? '';
    if (code === 'auth/user-not-found') {
      fatal(`no Firebase Auth user found for ${email}`);
    }
    fatal(`could not look up user: ${(e as Error).message}`);
  }

  const existing = user.customClaims ?? {};
  const next = { ...existing, admin: true, role: 'super_admin' };

  await auth.setCustomUserClaims(user.uid, next);

  console.log(`✓ Promoted ${email}`);
  console.log(`  uid:    ${user.uid}`);
  console.log(`  claims: ${JSON.stringify(next)}`);
  console.log('');
  console.log('The user must sign out and back in for the new claims to be picked up.');
  console.log('Remove BOOTSTRAP_ADMIN_EMAILS from the dashboard env once this user can sign in.');
}

main().catch(e => fatal((e as Error).message));
