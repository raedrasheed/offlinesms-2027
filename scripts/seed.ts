// Seed Firestore with demo users, conversations, messages, and wallets.
// Run: npm run seed
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!credPath) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS in .env'); process.exit(1);
}
const credential = cert(JSON.parse(readFileSync(credPath, 'utf-8')));
initializeApp({ credential });

const db = getFirestore();

async function main() {
  console.log('Seeding…');

  const users = [
    { id: 'demo_maya',     displayName: 'Maya Okonkwo',    phoneNumber: '+14155550190' },
    { id: 'demo_renison',  displayName: 'Renison Hathway', phoneNumber: '+14155550188' },
    { id: 'demo_jennifer', displayName: 'Jennifer Park',   phoneNumber: '+14155550173' },
    { id: 'demo_joy',      displayName: 'Joy Adeyemi',     phoneNumber: '+14155553492' },
  ];

  for (const u of users) {
    await db.collection('users').doc(u.id).set({ ...u, createdAt: FieldValue.serverTimestamp(), status: 'active' }, { merge: true });
    await db.collection('wallets').doc(u.id).set({ balance: 1250, reserved: 0 }, { merge: true });
    // F1 Phase A: mirror PII into the private subdoc (public field kept too).
    await db.collection('users').doc(u.id).collection('userPrivate').doc('profile')
      .set({ phoneNumber: u.phoneNumber, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  // 1:1 conversation
  const convo1 = await db.collection('conversations').add({
    type: 'dm',
    memberIds: ['demo_maya', 'demo_renison'],
    lastMessageText: "That's not ok",
    lastMessageAt: FieldValue.serverTimestamp(),
    lastSenderId: 'demo_renison',
  });
  await convo1.collection('members').doc('demo_maya').set({ role: 'member' });
  await convo1.collection('members').doc('demo_renison').set({ role: 'member' });
  await convo1.collection('messages').add({ senderId: 'demo_maya', type: 'text', text: 'Hey, on my way 🙌', createdAt: FieldValue.serverTimestamp() });
  await convo1.collection('messages').add({ senderId: 'demo_renison', type: 'text', text: "That's not ok", createdAt: FieldValue.serverTimestamp() });

  // Group conversation
  const group = await db.collection('conversations').add({
    type: 'group',
    name: 'Brand Refresh · Q3',
    memberIds: ['demo_maya', 'demo_renison', 'demo_jennifer', 'demo_joy'],
    lastMessageText: 'Heads up — sprint review pushed to Thursday 2pm',
    lastMessageAt: FieldValue.serverTimestamp(),
    lastSenderId: 'demo_maya',
  });
  for (const uid of ['demo_maya', 'demo_renison', 'demo_jennifer', 'demo_joy']) {
    await group.collection('members').doc(uid).set({ role: uid === 'demo_maya' ? 'admin' : 'member' });
  }
  await group.collection('messages').add({
    senderId: 'demo_maya', type: 'text',
    text: 'Heads up team — sprint review pushed to Thursday 2pm. Bring your slides.',
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
