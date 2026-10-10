// Email change — drain status (READ-ONLY).
//
// Before anything that weakens the email-change protection is considered (see
// docs/EMAIL_CHANGE_VERIFICATION.md §4, rollback), the change must be switched
// off and nothing may still be able to write an Auth email:
//   - systemSettings/general.emailChangeEnabled is not true (no new change
//     starts or is accepted);
//   - no emailChangeOps/{uid} is mid-way (stage verified / auth-updated);
//   - no emailChangeAuthWrites/{uid} has a pending or uncertain Auth write, or
//     is still scheduled for reconciliation.
// It prints counts only — no addresses, uids or codes — and never writes.
//
// Credentials: Application Default Credentials (a key file in
// GOOGLE_APPLICATION_CREDENTIALS, or your own login / Cloud Shell) with read
// access to Firestore (Cloud Datastore Viewer is enough).
//
// Usage:
//   npx tsx scripts/emailChangeDrainStatus.ts --project <project-id>
//
// Exit code: 0 drained · 1 not drained · 2 bad invocation or read error.

import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';

const i = process.argv.indexOf('--project');
const project = i > 0 ? process.argv[i + 1] : undefined;
if (!project) { console.error('usage: --project <id>'); process.exit(2); }

initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: project } : { credential: applicationDefault(), projectId: project });
const db = getFirestore();

const nonEmpty = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v as object).length > 0;

async function main() {
  const settings = (await db.collection('systemSettings').doc('general').get()).data() ?? {};
  const switchOn = settings.emailChangeEnabled === true;
  const midway = (await db.collection('emailChangeOps').where('stage', 'in', ['verified', 'auth-updated']).count().get()).data().count;

  let ledgers = 0, pending = 0, uncertain = 0, scheduled = 0, conflicts = 0;
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection('emailChangeAuthWrites').orderBy('__name__').limit(500);
    if (last) q = q.startAfter(last);
    const page = await q.get();
    for (const d of page.docs) {
      ledgers++;
      if (nonEmpty(d.get('pending'))) pending++;
      if (nonEmpty(d.get('uncertain'))) uncertain++;
      if (typeof d.get('reconcileAtMs') === 'number') scheduled++;
      if (d.get('conflict')) conflicts++;
    }
    if (page.size < 500) break;
    last = page.docs[page.docs.length - 1];
  }

  console.log(`Email change drain status — project ${project} (read-only)`);
  console.log(`  emailChangeEnabled                         : ${switchOn ? 'ON' : 'off'}`);
  console.log(`  changes mid-way (verified / auth-updated)  : ${midway}`);
  console.log(`  accounts with a ledger                     : ${ledgers}`);
  console.log(`  …with a pending Auth write                 : ${pending}`);
  console.log(`  …with an uncertain Auth write              : ${uncertain}`);
  console.log(`  …still scheduled for reconciliation        : ${scheduled}`);
  console.log(`  …with a repair conflict (needs support)    : ${conflicts}`);

  const drained = !switchOn && midway === 0 && pending === 0 && uncertain === 0 && scheduled === 0;
  console.log(drained
    ? 'DRAINED: the change is off and no Auth email write can still land.'
    : 'NOT DRAINED: keep the guards and the change functions deployed; turn the switch off and re-run later (mid-way changes finish when their owners resume; the scheduled pass settles pending and uncertain writes).');
  process.exit(drained ? 0 : 1);
}

main().catch(e => { console.error('read failed:', (e as Error).message); process.exit(2); });
