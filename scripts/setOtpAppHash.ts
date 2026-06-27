// Set (or clear) the Android SMS Retriever app-signature hash used for zero-tap
// OTP auto-read. Writes smsConfig/otp = { androidAppHash }.
//
// When set, requestPhoneOtp appends the hash to the OTP SMS (SMS Retriever
// format) so the app auto-reads the code with no tap. The hash differs per
// signing key — read it from the build you ship (the OTP screen's __DEV__
// "show SMS Retriever hash" button, or react-native-otp-verify getHash()).
//
// Run:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   APP_HASH=<11-char-hash> npx tsx scripts/setOtpAppHash.ts
//
// Clear it (revert to plain SMS):
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   APP_HASH= npx tsx scripts/setOtpAppHash.ts
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
// Distinguish "unset" (show usage) from "" (explicit clear).
const appHashRaw = process.env.APP_HASH;
if (!credPath)            { console.error('Set GOOGLE_APPLICATION_CREDENTIALS in .env'); process.exit(1); }
if (appHashRaw === undefined) { console.error('Set APP_HASH=<11-char-hash> (or APP_HASH= to clear)'); process.exit(1); }

const appHash = appHashRaw.trim();

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });

getFirestore().collection('smsConfig').doc('otp')
  .set(
    {
      // Empty → delete the field so the backend treats it as "unset" (plain SMS).
      androidAppHash: appHash ? appHash : FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )
  .then(() => { console.log(appHash ? `OTP app hash set to ${appHash}.` : 'OTP app hash cleared.'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
