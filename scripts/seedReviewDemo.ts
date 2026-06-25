// Seed the App Review demo account + pre-populated content.
//
// Creates a NON-EXPIRING email/password account Apple reviewers can use to test
// every end-user feature without real SMS or relay coverage, plus sample chats,
// a contact to start a new chat with, and points balance + history.
//
// Run (against the prod project):
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   DEMO_REVIEW_EMAIL=appreview@offlinesms.com \
//   DEMO_REVIEW_PASSWORD='<choose-a-strong-password>' \
//   npx tsx scripts/seedReviewDemo.ts
//
// The password is read from the environment so it is NEVER committed. Put the
// same email/password into App Store Connect → App Review Information.
//
// Messages are written with the app's canonical doc shapes, so the existing
// onMessageCreate triggers fan out receipts / unread / lastMessage exactly as a
// real send would. Idempotent: re-running updates the same docs.

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

const DEMO_UID = 'appreview_demo';
const CONTACTS = [
  { id: 'appreview_contact_lina', displayName: 'Lina Haddad', username: 'lina', usernameLower: 'lina', phoneNumber: '+14155550111' },
  { id: 'appreview_contact_sam',  displayName: 'Sam Rivera',  username: 'samr', usernameLower: 'samr', phoneNumber: '+14155550122' },
];

function directKey(a: string, b: string) { return [a, b].sort().join('_'); }

async function ensureAuthUser() {
  try {
    await auth.updateUser(DEMO_UID, { email, password, emailVerified: true, displayName: 'OfflineSMS Reviewer' });
    console.log('Updated demo auth user', DEMO_UID);
  } catch {
    await auth.createUser({ uid: DEMO_UID, email, password, emailVerified: true, displayName: 'OfflineSMS Reviewer' });
    console.log('Created demo auth user', DEMO_UID);
  }
}

async function ensureUserDoc(uid: string, fields: Record<string, unknown>) {
  await db.collection('users').doc(uid).set(
    { ...fields, profileCompleted: true, status: 'active', createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

async function main() {
  console.log('Seeding App Review demo…');

  await ensureAuthUser();

  // Demo user profile + contacts (contacts are searchable by username so the
  // reviewer can start a brand-new chat).
  await ensureUserDoc(DEMO_UID, {
    displayName: 'OfflineSMS Reviewer', username: 'reviewer', usernameLower: 'reviewer',
    email, about: 'App Review demo account',
  });
  for (const c of CONTACTS) await ensureUserDoc(c.id, c);

  // Wallet with a visible balance.
  await db.collection('wallets').doc(DEMO_UID).set(
    { balance: 2500, reserved: 0, updatedAt: FieldValue.serverTimestamp() }, { merge: true },
  );

  // Transaction history (admin grant + an SMS spend) so the Points screens show data.
  const txCol = db.collection('transactions');
  await txCol.doc('appreview_tx_grant').set({
    userId: DEMO_UID, type: 'admin_adjustment', direction: 'credit', amount: 3000, status: 'completed',
    note: 'Points assigned by admin', createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await txCol.doc('appreview_tx_spend').set({
    userId: DEMO_UID, type: 'sms_spend', direction: 'debit', amount: 500, status: 'completed',
    createdAt: FieldValue.serverTimestamp(), completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  // One existing direct conversation (canonical shape) with sent + received messages.
  const peer = CONTACTS[0];
  const key = directKey(DEMO_UID, peer.id);
  const existing = await db.collection('conversations').where('participantKey', '==', key).limit(1).get();
  const convoRef = existing.empty ? db.collection('conversations').doc() : existing.docs[0].ref;
  const now = FieldValue.serverTimestamp();
  const participantUids = [DEMO_UID, peer.id];
  await convoRef.set({
    type: 'direct', participantUids, participantKey: key, memberIds: participantUids,
    createdBy: peer.id, status: 'active',
    lastMessage: null, lastMessageText: '', lastMessageAt: now, lastSenderId: '',
    createdAt: now, updatedAt: now,
  }, { merge: true });
  for (const uid of participantUids) {
    await convoRef.collection('userState').doc(uid).set({
      uid, pinned: false, muted: false, archived: false, favorite: false,
      unreadCount: 0, lastReadAt: now, lastMessagePreview: '', lastMessageAt: now, updatedAt: now,
    }, { merge: true });
  }
  // Only seed messages once (avoid duplicates on re-run).
  const msgs = await convoRef.collection('messages').limit(1).get();
  if (msgs.empty) {
    const mk = (senderUid: string, senderDisplayName: string, text: string) => ({
      conversationId: convoRef.id, senderUid, senderId: senderUid, type: 'text', text,
      status: 'sent', deletedForEveryone: false, senderDisplayName,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    // The onMessageCreate trigger fans out receipts / unread / lastMessage.
    await convoRef.collection('messages').add(mk(peer.id, peer.displayName, 'Welcome to OfflineSMS! 👋'));
    await convoRef.collection('messages').add(mk(DEMO_UID, 'OfflineSMS Reviewer', 'Thanks — testing the app.'));
    await convoRef.collection('messages').add(mk(peer.id, peer.displayName, 'Great, let me know if you need anything.'));
  }

  console.log('Done.');
  console.log(`Demo login → email: ${email}  (password from DEMO_REVIEW_PASSWORD env)`);
}

main().catch(e => { console.error(e); process.exit(1); });
