// Email sign-in guards — live check through real Firebase Auth requests.
//
// Exercises the two blocking functions added for the email change
// (functions/src/emailChange/emailSignInBlocking.ts) the way a client reaches
// them: through the Identity Toolkit REST API the Firebase SDKs call, not by
// calling the handlers. Blocking functions run only for these routes: email +
// password (and email-link) sign-in, and password-reset / sign-in-link emails.
// Custom-token sign-ins (the app's email-code and phone sign-in) never trigger
// them, so a code sign-in after a deploy says nothing about the guards; the
// email-code route has its own server-side check in verifyEmailOtp, which this
// script calls separately (check 3, last item).
// It checks:
//   1. registration — the project's Identity Platform config routes
//      beforeSignIn → guardEmailSignIn and beforeSendEmail → guardEmailSent,
//      and beforeCreate still → onUserCreate [real projects only];
//   2. the key reaches this project — a fresh account with no change history
//      signs in with its password through FIREBASE_WEB_API_KEY (this is also
//      the control that the guard leaves ordinary password sign-in alone);
//   3. a replaced address (the Auth record carries it, the account's settled
//      address is another one, as after a stale Auth write):
//        - email + password sign-in is refused with `address-replaced`, and the
//          Auth record is repaired to the settled address;
//        - a password-reset email to it is refused [real projects only: the
//          Auth emulator does not run beforeSendEmail], and repaired again;
//        - the deployed verifyEmailOtp callable, given a valid code for it,
//          refuses it with `address-replaced` (the code is planted as a hashed
//          emailOtpChallenges doc, as requestEmailOtp would store it; no email
//          is sent), and accepts a valid code for the settled address;
//   4. controls — the settled address signs in with its password; with
//      --reset-inbox, a password reset for a settled address is accepted (one
//      real email to that inbox).
//
// It creates throwaway users (verify-guards-<run>-…@<domain>), their
// emailChangeAuthWrites/{uid} docs and code challenges, and deletes them (and
// the profile docs verifyEmailOtp writes) at the end; audit rows of the
// refusals and of the accepted code sign-in stay. It prints no
// passwords, tokens or codes. It refuses the production project unless
// --registration-only (read-only) or --allow-production (the post-deploy check
// in docs/EMAIL_CHANGE_VERIFICATION.md §4, after the owner's go-ahead).
//
// Credentials: Application Default Credentials — a service-account key file in
// GOOGLE_APPLICATION_CREDENTIALS, or your own short-lived login
// (`gcloud auth application-default login`, or Cloud Shell). Needed: Firebase
// Authentication Admin (users, Identity Platform config) and Cloud Datastore
// User (the ledger, challenge and profile docs). No token signing.
//
// Usage — local emulators (auth + firestore + functions running):
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     npx tsx scripts/verifyEmailSignInGuards.ts --project demo-offlinesms
// Usage — a NON-production test project with the functions deployed:
//   FIREBASE_WEB_API_KEY=<that project's web apiKey> \
//     npx tsx scripts/verifyEmailSignInGuards.ts --project <test-project-id> [--domain <domain>] [--reset-inbox <address you can read>]
// Usage — read-only registration check (creates nothing):
//   npx tsx scripts/verifyEmailSignInGuards.ts --project <project-id> --registration-only
// Usage — production, after the guards are deployed (creates and deletes throwaway users):
//   FIREBASE_WEB_API_KEY=<production web apiKey> \
//     npx tsx scripts/verifyEmailSignInGuards.ts --project offlinesms-prod-2027 --allow-production
//
// Exit code: 0 all checks passed · 1 a check failed · 2 bad invocation.

import { applicationDefault, getApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { hashOtp, newSalt } from '../functions/src/auth/otpLogic';
import { emailKey } from '../functions/src/auth/emailOtpLogic';

const PRODUCTION_PROJECT = 'offlinesms-prod-2027';
const LEDGER = 'emailChangeAuthWrites';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const project = arg('project');
const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const registrationOnly = process.argv.includes('--registration-only');
const allowProduction = process.argv.includes('--allow-production');
if (!project) { console.error('usage: --project <id> (see the header)'); process.exit(2); }
if (registrationOnly && emulator) { console.error('--registration-only reads a real project\'s Identity Platform config; unset FIREBASE_AUTH_EMULATOR_HOST.'); process.exit(2); }
if (project === PRODUCTION_PROJECT && !registrationOnly && !allowProduction) {
  console.error('Refusing the production project: run this against the emulators or a test project, or pass --registration-only (read-only) or --allow-production (post-deploy check, see the header).');
  process.exit(2);
}
if (allowProduction && project !== PRODUCTION_PROJECT) { console.error('--allow-production is only for offlinesms-prod-2027.'); process.exit(2); }
if (!emulator && !registrationOnly && !process.env.FIREBASE_WEB_API_KEY) { console.error('Set FIREBASE_WEB_API_KEY (the test project\'s web apiKey).'); process.exit(2); }
if (emulator && !process.env.FIRESTORE_EMULATOR_HOST) { console.error('Set FIRESTORE_EMULATOR_HOST too, or the ledger docs would go to a real project.'); process.exit(2); }

initializeApp(emulator ? { projectId: project } : { credential: applicationDefault(), projectId: project });
const auth = getAuth();
const db = getFirestore();

const API_KEY = emulator ? 'emulator-key' : process.env.FIREBASE_WEB_API_KEY ?? '';
const TOOLKIT = emulator ? `http://${emulator}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
const run = randomBytes(3).toString('hex');
const domain = arg('domain') ?? 'example.com';
const resetInbox = arg('reset-inbox');
const addr = (tag: string) => `verify-guards-${run}-${tag}@${domain}`;
const password = randomBytes(18).toString('base64url');

type RestResult = ({ ok: true; body: Record<string, unknown> } | { ok: false; message: string }) & { ms: number };

// Identity Platform gives a blocking function 7 s; the round trip is printed so a
// slow (cold) hook shows up before it starts failing password sign-ins.
async function rest(method: string, body: Record<string, unknown>): Promise<RestResult> {
  const t0 = Date.now();
  const r = await fetch(`${TOOLKIT}/v1/${method}?key=${encodeURIComponent(API_KEY)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({})) as { error?: { message?: string } };
  const ms = Date.now() - t0;
  return r.ok ? { ok: true, body: json as Record<string, unknown>, ms } : { ok: false, message: json.error?.message ?? `HTTP ${r.status}`, ms };
}
const signInWithPassword = (email: string) => rest('accounts:signInWithPassword', { email, password, returnSecureToken: true });

// The deployed verifyEmailOtp callable, called as the app calls it.
const FUNCTIONS = emulator
  ? `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? '127.0.0.1:5001'}/${project}/us-central1`
  : `https://us-central1-${project}.cloudfunctions.net`;
async function emailCodeSignIn(email: string): Promise<RestResult> {
  // Plant a valid code exactly as requestEmailOtp stores it (salted hash only).
  const code = String(100000 + (randomBytes(4).readUInt32BE() % 900000));
  const salt = newSalt();
  await db.collection('emailOtpChallenges').doc(emailKey(email)).set({
    codeHash: hashOtp(code, salt), salt, attempts: 0, status: 'pending',
    expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60_000),
  });
  const t0 = Date.now();
  const r = await fetch(`${FUNCTIONS}/verifyEmailOtp`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: { email, code } }),
  });
  const json = await r.json().catch(() => ({})) as { result?: Record<string, unknown>; error?: { message?: string } };
  const ms = Date.now() - t0;
  return r.ok && json.result ? { ok: true, body: { tokenIssued: typeof json.result.customToken === 'string' }, ms } : { ok: false, message: json.error?.message ?? `HTTP ${r.status}`, ms };
}
const sendPasswordReset = (email: string) => rest('accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email });

let failures = 0;
function check(name: string, pass: boolean, detail = '') {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const refusedAsReplaced = (r: RestResult) => !r.ok && r.message.includes('address-replaced');
const describe = (r: RestResult) => `${r.ok ? 'accepted' : `refused: ${r.message.slice(0, 160)}`} (${r.ms} ms)`;

async function authEmailBecomes(uid: string, want: string, ms = 10_000): Promise<string | undefined> {
  const end = Date.now() + ms;
  let email: string | undefined;
  while (Date.now() < end) {
    email = (await auth.getUser(uid)).email;
    if (email === want) return email;
    await new Promise(r => setTimeout(r, 500));
  }
  return email;
}

async function registration() {
  const token = await getApp().options.credential!.getAccessToken();
  const r = await fetch(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`, {
    // x-goog-user-project: quota project, needed when the credential is a user login.
    headers: { authorization: `Bearer ${token.access_token}`, 'x-goog-user-project': project! },
  });
  if (!r.ok) throw new Error(`reading the Identity Platform config failed: HTTP ${r.status}`);
  const cfg = await r.json() as { blockingFunctions?: { triggers?: Record<string, { functionUri?: string }> } };
  const triggers = cfg.blockingFunctions?.triggers ?? {};
  console.log('      blocking triggers:', JSON.stringify(Object.fromEntries(Object.entries(triggers).map(([k, v]) => [k, v.functionUri]))));
  check('beforeSignIn is routed to guardEmailSignIn', /guardemailsignin/i.test(triggers.beforeSignIn?.functionUri ?? ''));
  check('beforeSendEmail is routed to guardEmailSent', /guardemailsent/i.test(triggers.beforeSendEmail?.functionUri ?? ''));
  check('beforeCreate is still routed to onUserCreate', /onusercreate/i.test(triggers.beforeCreate?.functionUri ?? ''));
}

async function main() {
  console.log(`Email sign-in guards — ${emulator ? `emulators (${emulator})` : `project ${project}`}${registrationOnly ? ', registration only' : `, run ${run}`}`);
  if (registrationOnly) {
    await registration();
    console.log(failures ? `NO-GO: ${failures} check(s) failed` : 'GO: both guards are registered');
    process.exit(failures ? 1 : 0);
  }
  const created: string[] = [];
  const make = async (email: string) => {
    const u = await auth.createUser({ email, password, emailVerified: true });
    created.push(u.uid);
    return u.uid;
  };
  try {
    if (!emulator) await registration();

    // The key reaches THIS project, and ordinary password sign-in is untouched:
    // an account with no change history signs in. Nothing below means anything
    // if the requests go to another project.
    const plainUid = await make(addr('plain'));
    const plain = await signInWithPassword(addr('plain'));
    const reaches = plain.ok && plain.body.localId === plainUid;
    check('an account that never changed its email signs in with its password (the key reaches this project)', reaches, describe(plain));
    if (!reaches) throw new Error('FIREBASE_WEB_API_KEY does not sign in to this project\'s accounts (another project\'s key, or Email/Password is off)');

    // A replaced address: the Auth record carries OLD, the settled address is NEW.
    const OLD = addr('old'), NEW = addr('new');
    const uid = await make(OLD);
    await db.collection(LEDGER).doc(uid).set({ settledEmail: NEW });

    const signin = await signInWithPassword(OLD);
    check('password sign-in with the replaced address is refused (address-replaced)', refusedAsReplaced(signin), describe(signin));
    const repaired = await authEmailBecomes(uid, NEW);
    check('the refusal repaired the Auth record to the settled address', repaired === NEW);

    if (emulator) {
      console.log('SKIP  password reset to the replaced address — the Auth emulator does not run beforeSendEmail; run against a test project');
    } else {
      await auth.updateUser(uid, { email: OLD }); // the stale address lands again
      const reset = await sendPasswordReset(OLD);
      check('password reset to the replaced address is refused (address-replaced)', refusedAsReplaced(reset), describe(reset));
      const repaired2 = await authEmailBecomes(uid, NEW);
      check('…and the Auth record was repaired again', repaired2 === NEW);
    }

    const settled = await signInWithPassword(NEW);
    check('password sign-in with the settled address is accepted', settled.ok, describe(settled));

    // The email-code route (custom tokens; no blocking function): verifyEmailOtp's own check.
    await auth.updateUser(uid, { email: OLD }); // the stale address lands again
    const codeOld = await emailCodeSignIn(OLD);
    check('email-code sign-in (verifyEmailOtp) with the replaced address is refused (address-replaced)', refusedAsReplaced(codeOld), describe(codeOld));
    const repaired3 = await authEmailBecomes(uid, NEW);
    check('…and the Auth record was repaired again', repaired3 === NEW);
    const codeNew = await emailCodeSignIn(NEW);
    check('email-code sign-in (verifyEmailOtp) with the settled address is accepted', codeNew.ok && codeNew.body.tokenIssued === true, describe(codeNew));

    if (!emulator && resetInbox) {
      const inboxUid = await make(resetInbox);
      await db.collection(LEDGER).doc(inboxUid).set({ settledEmail: resetInbox.toLowerCase() });
      const ok = await sendPasswordReset(resetInbox);
      check(`password reset for a settled address is accepted (one email sent to ${resetInbox})`, ok.ok, describe(ok));
    } else if (!emulator) {
      console.log('SKIP  accepted-reset control — pass --reset-inbox <address you can read> to send one real reset email');
    }
  } finally {
    for (const id of created) {
      await auth.deleteUser(id).catch(() => {});
      await db.collection(LEDGER).doc(id).delete().catch(() => {});
      await db.doc(`users/${id}/userPrivate/profile`).delete().catch(() => {});
      await db.doc(`users/${id}`).delete().catch(() => {});
    }
    for (const e of [addr('old'), addr('new')]) await db.collection('emailOtpChallenges').doc(emailKey(e)).delete().catch(() => {});
  }
  console.log(failures ? `NO-GO: ${failures} check(s) failed` : 'GO: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error('NO-GO: run failed:', (e as Error).message); process.exit(1); });
