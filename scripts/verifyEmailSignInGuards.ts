// Email sign-in guards — live check through real Firebase Auth requests.
//
// Exercises the two blocking functions added for the email change
// (functions/src/emailChange/emailSignInBlocking.ts) the way a client reaches
// them: through the Identity Toolkit REST API the Firebase SDKs call, not by
// calling the handlers. It checks:
//   1. registration — the project's Identity Platform config routes
//      beforeSignIn → guardEmailSignIn and beforeSendEmail → guardEmailSent,
//      and beforeCreate still → onUserCreate [real projects only];
//   2. a replaced address (the Auth record carries it, the account's settled
//      address is another one, as after a stale Auth write):
//        - email + password sign-in is refused with `address-replaced`, and the
//          Auth record is repaired to the settled address;
//        - a password-reset email to it is refused [test project only: the Auth
//          emulator does not run beforeSendEmail];
//   3. controls — the settled address signs in with its password; a
//      custom-token sign-in (the app's own path) passes; an account without
//      change history signs in; with --reset-inbox, a password reset for a
//      settled address is accepted (one real email to that inbox).
//
// It creates throwaway users (verify-guards-<run>-…@<domain>) and their
// emailChangeAuthWrites/{uid} docs, and deletes both at the end. Except with
// --registration-only it refuses the production project. It prints no
// passwords, tokens or codes.
//
// Usage — local emulators (auth + firestore + functions running):
//   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
//     npx tsx scripts/verifyEmailSignInGuards.ts --project demo-offlinesms
// Usage — a NON-production test project with the functions deployed:
//   GOOGLE_APPLICATION_CREDENTIALS=./test-project-sa.json FIREBASE_WEB_API_KEY=<web apiKey> \
//     npx tsx scripts/verifyEmailSignInGuards.ts --project <test-project-id> [--domain <domain>] [--reset-inbox <address you can read>]
// Usage — read-only registration check (allowed on production, creates nothing):
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json \
//     npx tsx scripts/verifyEmailSignInGuards.ts --project <project-id> --registration-only
//
// Exit code: 0 all checks passed · 1 a check failed · 2 bad invocation.

import { applicationDefault, getApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';

const PRODUCTION_PROJECT = 'offlinesms-prod-2027';
const LEDGER = 'emailChangeAuthWrites';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const project = arg('project');
const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const registrationOnly = process.argv.includes('--registration-only');
if (!project) { console.error('usage: --project <id> (see the header)'); process.exit(2); }
if (registrationOnly && emulator) { console.error('--registration-only reads a real project\'s Identity Platform config; unset FIREBASE_AUTH_EMULATOR_HOST.'); process.exit(2); }
if (project === PRODUCTION_PROJECT && !registrationOnly) { console.error('Refusing the production project: run this against the emulators or a test project (or pass --registration-only).'); process.exit(2); }
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
// slow (cold) hook shows up before it starts failing sign-ins.
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
const signInWithCustomToken = (token: string) => rest('accounts:signInWithCustomToken', { token, returnSecureToken: true });
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
    headers: { authorization: `Bearer ${token.access_token}` },
  });
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

    // Controls: nothing else is blocked.
    const settled = await signInWithPassword(NEW);
    check('password sign-in with the settled address is accepted', settled.ok, describe(settled));
    const custom = await signInWithCustomToken(await auth.createCustomToken(uid));
    check('custom-token sign-in (the app\'s own path) is accepted', custom.ok, describe(custom));
    const plainUid = await make(addr('plain'));
    const plain = await signInWithPassword(addr('plain'));
    check('an account that never changed its email signs in with its password', plain.ok && plain.body.localId === plainUid, describe(plain));

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
    }
  }
  console.log(failures ? `NO-GO: ${failures} check(s) failed` : 'GO: all checks passed');
  process.exit(failures ? 1 : 0);
}

main().catch(e => { console.error('NO-GO: run failed:', (e as Error).message); process.exit(1); });
