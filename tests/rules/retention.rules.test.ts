import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { asUser, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';
afterAll(teardownEnv);
beforeEach(clearAll);
describe('receipt retention boundary', () => {
  it('allows receipts on a live message, and refuses them during or after cleanup', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations/c/messages/live'), { senderUid: 'sender' });
      await setDoc(doc(db, 'conversations/c/messages/expiring'), { senderUid: 'sender', retentionDeleting: true });
    });
    const db = await asUser('peer');
    await assertSucceeds(setDoc(doc(db, 'conversations/c/messages/live/receipts/peer'), { status: 'read' }));
    await assertFails(setDoc(doc(db, 'conversations/c/messages/expiring/receipts/peer'), { status: 'read' }));
    await assertFails(setDoc(doc(db, 'conversations/c/messages/removed/receipts/peer'), { status: 'read' }));
  });
});
