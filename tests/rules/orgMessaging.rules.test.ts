// Firestore rules tests — Organization Messaging MVP collections.
// organizationApiKeys (server-only, keyHash inside), organizationMessageBatches,
// organizationMessages, organizationUsageCounters.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { asUser, asAdmin, asAnon, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

const asOrg1Admin = () => asUser('org1-admin', { role: 'organization_admin', organizationId: 'org1' });
const asOrg2Admin = () => asUser('org2-admin', { role: 'organization_admin', organizationId: 'org2' });

async function seedAll() {
  await seed(async db => {
    await setDoc(doc(db, 'organizationApiKeys', 'key-1'), {
      organizationId: 'org1', keyHash: 'SECRET_HASH', status: 'active',
    });
    await setDoc(doc(db, 'organizationMessageBatches', 'batch-1'), {
      organizationId: 'org1', source: 'api', createdBy: 'key-1',
      status: 'accepted', total: 1, accepted: 1, queued: 1, failed: 0, unsupported: 0,
    });
    await setDoc(doc(db, 'organizationMessages', 'msg-1'), {
      organizationId: 'org1', batchId: 'batch-1',
      recipientType: 'userId', recipientValue: 'u-1',
      title: 'T', body: 'B', status: 'queued', failureReason: null,
    });
    await setDoc(doc(db, 'organizationUsageCounters', 'org1_2026-06'), {
      organizationId: 'org1', month: '2026-06', used: 1, limit: 100,
    });
  });
}

describe('organizationApiKeys — fully server-side (keyHash never client-readable)', () => {
  it('no client may read a key doc — not even a platform admin or the org admin', async () => {
    await seedAll();
    await assertFails(getDoc(doc(await asAdmin(), 'organizationApiKeys', 'key-1')));
    await assertFails(getDoc(doc(await asOrg1Admin(), 'organizationApiKeys', 'key-1')));
    await assertFails(getDoc(doc(await asAnon(), 'organizationApiKeys', 'key-1')));
  });
  it('no client may write a key doc', async () => {
    await seedAll();
    await assertFails(setDoc(doc(await asAdmin(), 'organizationApiKeys', 'key-2'), { organizationId: 'org1', keyHash: 'X', status: 'active' }));
    await assertFails(updateDoc(doc(await asOrg1Admin(), 'organizationApiKeys', 'key-1'), { status: 'active' }));
  });
});

describe('organizationMessageBatches — org-scoped reads, server-only writes', () => {
  it('platform admin can read any batch', async () => {
    await seedAll();
    await assertSucceeds(getDoc(doc(await asAdmin(), 'organizationMessageBatches', 'batch-1')));
  });
  it('organization_admin can read their own org batches', async () => {
    await seedAll();
    await assertSucceeds(getDoc(doc(await asOrg1Admin(), 'organizationMessageBatches', 'batch-1')));
  });
  it("organization_admin cannot read another organization's batches", async () => {
    await seedAll();
    await assertFails(getDoc(doc(await asOrg2Admin(), 'organizationMessageBatches', 'batch-1')));
  });
  it('an org-scoped query for their own org succeeds; cross-org query fails', async () => {
    await seedAll();
    const own = await asOrg1Admin();
    await assertSucceeds(getDocs(query(collection(own, 'organizationMessageBatches'), where('organizationId', '==', 'org1'))));
    const other = await asOrg2Admin();
    await assertFails(getDocs(query(collection(other, 'organizationMessageBatches'), where('organizationId', '==', 'org1'))));
  });
  it('no client may write batches directly', async () => {
    await seedAll();
    await assertFails(setDoc(doc(await asAdmin(), 'organizationMessageBatches', 'b-x'), { organizationId: 'org1', status: 'accepted' }));
    await assertFails(updateDoc(doc(await asOrg1Admin(), 'organizationMessageBatches', 'batch-1'), { status: 'accepted' }));
  });
});

describe('organizationMessages — org-scoped reads, server-only writes', () => {
  it('organization_admin can read own-org message logs; cross-org rejected', async () => {
    await seedAll();
    await assertSucceeds(getDoc(doc(await asOrg1Admin(), 'organizationMessages', 'msg-1')));
    await assertFails(getDoc(doc(await asOrg2Admin(), 'organizationMessages', 'msg-1')));
  });
  it('platform admin can read message logs', async () => {
    await seedAll();
    await assertSucceeds(getDoc(doc(await asAdmin(), 'organizationMessages', 'msg-1')));
  });
  it('no client may write message logs directly', async () => {
    await seedAll();
    await assertFails(setDoc(doc(await asOrg1Admin(), 'organizationMessages', 'm-x'), { organizationId: 'org1', status: 'queued' }));
    // sneaking in a fake delivery status is rejected like any other write
    await assertFails(updateDoc(doc(await asAdmin(), 'organizationMessages', 'msg-1'), { status: 'sent' }));
  });
});

describe('organizationUsageCounters — org-scoped reads, server-only writes', () => {
  it('organization_admin can read their own counter; cross-org rejected', async () => {
    await seedAll();
    await assertSucceeds(getDoc(doc(await asOrg1Admin(), 'organizationUsageCounters', 'org1_2026-06')));
    await assertFails(getDoc(doc(await asOrg2Admin(), 'organizationUsageCounters', 'org1_2026-06')));
  });
  it('platform admin can read counters', async () => {
    await seedAll();
    await assertSucceeds(getDoc(doc(await asAdmin(), 'organizationUsageCounters', 'org1_2026-06')));
  });
  it('no client may write counters directly (quota cannot be reset client-side)', async () => {
    await seedAll();
    await assertFails(updateDoc(doc(await asOrg1Admin(), 'organizationUsageCounters', 'org1_2026-06'), { used: 0 }));
    await assertFails(setDoc(doc(await asAdmin(), 'organizationUsageCounters', 'org1_2026-07'), { used: 0 }));
  });
});
