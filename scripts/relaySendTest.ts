// Send ONE test SMS through the relay (no billing batch) to verify a device
// actually sends from its SIM. Creates a standalone relayJob the online device
// will claim on its next tick (~20s) and send; status flows back to sent/
// delivered and the dashboard relay queue + the device's "Today sent" update.
//
// Run:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   BUSINESS_ID=<organizationId> TO=+9725XXXXXXX [BODY="custom text"] \
//   npx tsx scripts/relaySendTest.ts
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const businessId = process.env.BUSINESS_ID;
const to = process.env.TO;
const body = process.env.BODY ?? 'OfflineSMS relay test ✅';
if (!credPath)   { console.error('Set GOOGLE_APPLICATION_CREDENTIALS in .env'); process.exit(1); }
if (!businessId) { console.error('Set BUSINESS_ID=<organizationId>'); process.exit(1); }
if (!to || !to.startsWith('+')) { console.error('Set TO=+<E164 phone> (e.g. +972591234567)'); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });
const db = getFirestore();

const jobId = `test_${businessId}_${Date.now()}`;

async function main() {
  await db.collection('relayJobs').doc(jobId).create({
    jobId,
    businessId,
    batchId: null,            // no billing batch → no Points/settlement
    recipientUid: null,
    phoneE164: to,
    messageBody: body,
    assignedDeviceId: null,   // any online device for this business may claim it
    assignedSimSubscriptionId: null,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    leaseOwnerDeviceId: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    traceId: jobId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`Queued relay test job ${jobId}`);
  console.log(`Business ${businessId} → ${to}`);
  console.log('An online device should claim & send within ~20s. Watch /admin/relay queue + the phone.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
