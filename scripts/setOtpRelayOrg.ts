// Designate the organization whose relay device sends sign-in OTP SMS.
// Writes smsConfig/otp = { businessId }.
//
// Run:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   BUSINESS_ID=<organizationId> npx tsx scripts/setOtpRelayOrg.ts
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const businessId = process.env.BUSINESS_ID;
if (!credPath)   { console.error('Set GOOGLE_APPLICATION_CREDENTIALS in .env'); process.exit(1); }
if (!businessId) { console.error('Set BUSINESS_ID=<organizationId>'); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });

getFirestore().collection('smsConfig').doc('otp')
  .set({ businessId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  .then(() => { console.log(`OTP relay org set to ${businessId}.`); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
