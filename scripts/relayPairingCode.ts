// Mint a relay pairing code for Phase 2 testing (until the dashboard Relay
// admin UI lands in Phase 4). Writes the same relayPairingCodes/{code} doc the
// createRelayPairingCode callable produces, so a relay device can enroll.
//
// Run: GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//      BUSINESS_ID=<organizationId> npx tsx scripts/relayPairingCode.ts
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const businessId = process.env.BUSINESS_ID;
if (!credPath) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS in .env'); process.exit(1); }
if (!businessId) { console.error('Set BUSINESS_ID=<organizationId>'); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });
const db = getFirestore();

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const code = Array.from({ length: 8 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
const TTL_MS = 15 * 60 * 1000;

async function main() {
  await db.collection('relayPairingCodes').doc(code).set({
    code,
    businessId,
    createdByUid: 'script:relayPairingCode',
    label: 'test device',
    used: false,
    expiresAt: Timestamp.fromMillis(Date.now() + TTL_MS),
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log(`Pairing code for business ${businessId}: ${code}`);
  console.log(`Expires in 15 minutes. Enter it in the OfflineSMS-Business app.`);
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
