import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { asAdmin, asUser, clearAll, seed, teardownEnv } from '../helpers/rules-helpers';

afterAll(teardownEnv);
beforeEach(clearAll);

const shapes = [
  { name: 'group', data: { type: 'group', ownerUid: 'owner', participantUids: ['owner'] } },
  { name: 'direct', data: { type: 'direct', participantUids: ['owner', 'peer'] } },
  { name: 'legacy', data: { memberIds: ['owner', 'peer'] } },
] as const;

describe('server-owned media ACL certification', () => {
  it.each([2, 1, 0, '2', null, true, {}, []].map(value => ({ value, label: JSON.stringify(value) })))(
    'rejects client ACL marker $label on every conversation create',
    async ({ value }) => {
      const owner = await asUser('owner');
      for (const shape of shapes) {
        await assertFails(setDoc(doc(owner, `conversations/forged-${shape.name}`), {
          ...shape.data, mediaAclVersion: value,
        }));
      }
    },
  );

  it('preserves unmarked legacy client creates and trusted server/admin certification', async () => {
    const owner = await asUser('owner');
    const admin = await asAdmin('owner');
    for (const shape of shapes) {
      await assertSucceeds(setDoc(doc(owner, `conversations/legacy-${shape.name}`), shape.data));
      await assertFails(updateDoc(doc(owner, `conversations/legacy-${shape.name}`), { mediaAclVersion: 2 }));
      await assertSucceeds(setDoc(doc(admin, `conversations/admin-${shape.name}`), { ...shape.data, mediaAclVersion: 2 }));
    }
    await seed(async db => {
      await setDoc(doc(db, 'conversations/server-group'), { ...shapes[0].data, mediaAclVersion: 2 });
    });
    expect((await getDoc(doc(owner, 'conversations/server-group'))).get('mediaAclVersion')).toBe(2);
  });

  it('cannot certify a deleted group parent again while its old messages remain', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations/recreated'), { ...shapes[0].data, mediaAclVersion: 2 });
      await setDoc(doc(db, 'conversations/recreated/members/owner'), { role: 'owner', status: 'active' });
      await setDoc(doc(db, 'conversations/recreated/messages/old'), { senderUid: 'owner', type: 'image' });
    });
    const owner = await asUser('owner');
    await assertSucceeds(deleteDoc(doc(owner, 'conversations/recreated')));
    await assertFails(setDoc(doc(owner, 'conversations/recreated'), { ...shapes[0].data, mediaAclVersion: 2 }));
    await seed(async db => {
      expect((await getDoc(doc(db, 'conversations/recreated/messages/old'))).exists()).toBe(true);
    });
  });
});
