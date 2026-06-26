// Seed the App Review demo accounts + pre-populated content.
//
// Provisions the accounts Apple reviewers use to test every end-user feature
// without real SMS, plus sample chats, a contact to start a new chat with, and
// points balance + history. Two sign-in options are seeded:
//
//   1) PHONE (primary): +970599999999, verification code 123456 (the fixed
//      App-review test number; the backend skips real SMS for it).
//   2) EMAIL/PASSWORD (fallback): DEMO_REVIEW_EMAIL + DEMO_REVIEW_PASSWORD,
//      via Welcome → "Use email" → "Sign in with a password instead".
//
// Run (against the prod project):
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   DEMO_REVIEW_EMAIL=appreview@offlinesms.com \
//   DEMO_REVIEW_PASSWORD='<choose-a-strong-password>' \
//   npm run seed:review
//
// The password is read from the environment so it is NEVER committed. Put the
// same credentials into App Store Connect → App Review Information.
//
// Messages use the app's canonical doc shapes, so the existing onMessageCreate
// triggers fan out receipts / unread / lastMessage. Idempotent: re-running
// updates the same docs and does not duplicate messages.

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) { console.error('Set GOOGLE_APPLICATION_CREDENTIALS in .env'); process.exit(1); }
const email = process.env.DEMO_REVIEW_EMAIL || 'appreview@offlinesms.com';
const password = process.env.DEMO_REVIEW_PASSWORD;
if (!password || password.length < 8) {
  console.error('Set DEMO_REVIEW_PASSWORD (>= 8 chars) in the environment'); process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, 'utf-8'))) });
const db = getFirestore();
const auth = getAuth();

// Fixed App-review test phone (must match functions/src/auth/otpLogic.ts).
const TEST_PHONE = '+970599999999';
const EMAIL_UID = 'appreview_demo';
const CONTACTS = [
  { id: 'appreview_contact_lina', displayName: 'Lina Haddad', username: 'lina', usernameLower: 'lina', phoneNumber: '+14155550111' },
  { id: 'appreview_contact_sam',  displayName: 'Sam Rivera',  username: 'samr', usernameLower: 'samr', phoneNumber: '+14155550122' },
];

function directKey(a: string, b: string) { return [a, b].sort().join('_'); }

async function ensureUserDoc(uid: string, fields: Record<string, unknown>) {
  await db.collection('users').doc(uid).set(
    { ...fields, profileCompleted: true, status: 'active', createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  // F1 Phase A: mirror PII into the private subdoc (public fields kept too).
  const priv: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (fields.phoneNumber !== undefined) priv.phoneNumber = fields.phoneNumber;
  if (fields.email !== undefined) priv.email = fields.email;
  if (priv.phoneNumber !== undefined || priv.email !== undefined) {
    await db.collection('users').doc(uid).collection('private').doc('profile').set(priv, { merge: true });
  }
}

/** Wallet + transaction history + one existing chat with sent/received messages. */
async function seedContentFor(uid: string, displayName: string, idPrefix: string) {
  // Wallet with a visible balance.
  await db.collection('wallets').doc(uid).set(
    { balance: 2500, reserved: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true },
  );

  // Transaction history (admin grant + an SMS spend).
  await db.collection('transactions').doc(`${idPrefix}_tx_grant`).set({
    userId: uid, type: 'admin_adjustment', direction: 'credit', amount: 3000, status: 'completed',
    note: 'Points assigned by admin', createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection('transactions').doc(`${idPrefix}_tx_spend`).set({
    userId: uid, type: 'sms_spend', direction: 'debit', amount: 500, status: 'completed',
    createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // One existing direct conversation (canonical shape) with sent + received messages.
  const peer = CONTACTS[0];
  const key = directKey(uid, peer.id);
  const existing = await db.collection('conversations').where('participantKey', '==', key).limit(1).get();
  const convoRef = existing.empty ? db.collection('conversations').doc() : existing.docs[0].ref;
  const now = FieldValue.serverTimestamp();
  const participantUids = [uid, peer.id];
  await convoRef.set({
    type: 'direct', participantUids, participantKey: key, memberIds: participantUids,
    createdBy: peer.id, status: 'active',
    lastMessage: null, lastMessageText: '', lastMessageAt: now, lastSenderId: '',
    createdAt: now, updatedAt: now,
  }, { merge: true });
  for (const u of participantUids) {
    await convoRef.collection('userState').doc(u).set({
      uid: u, pinned: false, muted: false, archived: false, favorite: false,
      unreadCount: 0, lastReadAt: now, lastMessagePreview: '', lastMessageAt: now, updatedAt: now,
    }, { merge: true });
  }
  const msgs = await convoRef.collection('messages').limit(1).get();
  if (msgs.empty) {
    const mk = (senderUid: string, senderDisplayName: string, text: string) => ({
      conversationId: convoRef.id, senderUid, senderId: senderUid, type: 'text', text,
      status: 'sent', deletedForEveryone: false, senderDisplayName,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    await convoRef.collection('messages').add(mk(peer.id, peer.displayName, 'Welcome to OfflineSMS! 👋'));
    await convoRef.collection('messages').add(mk(uid, displayName, 'Thanks — testing the app.'));
    await convoRef.collection('messages').add(mk(peer.id, peer.displayName, 'Great, let me know if you need anything.'));
  }
}

async function provisionPhoneAccount(): Promise<string> {
  let uid: string;
  try {
    uid = (await auth.getUserByPhoneNumber(TEST_PHONE)).uid;
    console.log('Found existing phone test user', uid);
  } catch {
    uid = (await auth.createUser({ phoneNumber: TEST_PHONE })).uid;
    console.log('Created phone test user', uid);
  }
  await ensureUserDoc(uid, {
    displayName: 'OfflineSMS Reviewer', username: 'reviewer', usernameLower: 'reviewer',
    phoneNumber: TEST_PHONE, phoneVerified: true, about: 'App Review demo account',
  });
  return uid;
}

async function provisionEmailAccount(): Promise<string> {
  try {
    await auth.updateUser(EMAIL_UID, { email, password, emailVerified: true, displayName: 'OfflineSMS Reviewer' });
    console.log('Updated email demo user', EMAIL_UID);
  } catch {
    await auth.createUser({ uid: EMAIL_UID, email, password, emailVerified: true, displayName: 'OfflineSMS Reviewer' });
    console.log('Created email demo user', EMAIL_UID);
  }
  await ensureUserDoc(EMAIL_UID, {
    displayName: 'OfflineSMS Reviewer', username: 'reviewer_email', usernameLower: 'reviewer_email',
    email, about: 'App Review demo account',
  });
  return EMAIL_UID;
}

async function main() {
  console.log('Seeding App Review demo…');

  // Searchable contacts so the reviewer can start a brand-new chat.
  for (const c of CONTACTS) await ensureUserDoc(c.id, c);

  const phoneUid = await provisionPhoneAccount();
  await seedContentFor(phoneUid, 'OfflineSMS Reviewer', 'appreview_phone');

  const emailUid = await provisionEmailAccount();
  await seedContentFor(emailUid, 'OfflineSMS Reviewer', 'appreview_email');

  console.log('Done.');
  console.log(`Phone login → ${TEST_PHONE}  code 123456`);
  console.log(`Email login → ${email}  (password from DEMO_REVIEW_PASSWORD env)`);
}

main().catch(e => { console.error(e); process.exit(1); });
