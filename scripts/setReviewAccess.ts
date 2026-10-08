// Store-review access for public phone sign-in — the controlled replacement for
// the fixed review credential that used to be hard-coded in source.
//
// Enables, for at most 30 days, ONE number that signs into ONE pre-existing
// demo account with a code generated here (stored only as a salted hash). No
// SMS is ever sent for that number. Revoke at any time with --disable.
//
// Prerequisites (see docs/PHONE_LINKING_SECURITY.md §Store review):
//   • a dedicated demo account with sanitized data, no points, no admin/org/relay
//     roles; pass its uid with --uid
//   • a number the business controls (e.g. a relay SIM's own number) — never a
//     made-up number that might belong to a real person
//
// The generated code is printed ONCE to this terminal for the store-review notes.
// Never commit it, paste it into a PR, or log it elsewhere.
//
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json npx tsx scripts/setReviewAccess.ts \
//     --project=<id> --phone=+9705XXXXXXXX --uid=<demoUid> --days=14
//   GOOGLE_APPLICATION_CREDENTIALS=./sa.json npx tsx scripts/setReviewAccess.ts --project=<id> --disable

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { readFileSync } from 'node:fs';

const arg = (n: string) => process.argv.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');

async function main() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath && !process.env.FIRESTORE_EMULATOR_HOST) { console.error('NO-GO: set GOOGLE_APPLICATION_CREDENTIALS'); process.exit(2); }
  const sa = credPath ? JSON.parse(readFileSync(credPath, 'utf-8')) : null;
  const projectId = sa?.project_id ?? process.env.GCLOUD_PROJECT;
  if (arg('project') !== projectId) { console.error(`NO-GO: pass --project=${projectId} to confirm the target`); process.exit(2); }
  initializeApp(sa ? { credential: cert(sa) } : { projectId });
  const ref = getFirestore().collection('smsConfig').doc('otp');

  if (process.argv.includes('--disable')) {
    await ref.set({ signin: { review: { enabled: false } }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log('Review access disabled.');
    return;
  }

  const phone = arg('phone');
  const uid = arg('uid');
  const days = Math.min(30, Math.max(1, Number(arg('days') ?? 14)));
  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone) || !uid) { console.error('Usage: --phone=+E164 --uid=<demoUid> [--days=14]'); process.exit(2); }
  const demo = await getAuth().getUser(uid); // must exist; never created here
  if (demo.disabled) { console.error('Demo account is disabled.'); process.exit(2); }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const codeSalt = randomBytes(16).toString('hex');
  const codeHash = createHash('sha256').update(`${codeSalt}:${code}`).digest('hex');
  await ref.set({
    signin: { review: { enabled: true, phoneE164: phone, codeSalt, codeHash, uid, expiresAtMs: Date.now() + days * 86_400_000 } },
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  console.log(`Review access enabled for ${days} day(s). Code (shown once): ${code}`);
}

main().catch(e => { console.error('failed:', (e as Error)?.message); process.exit(1); });
