// N6 — generation-conditional, paginated cleanup of stale queued verification
// codes (functions/src/verification/staleJobSweep.ts). Layer: handler/emulator
// with a test seam between each page query and each job's transaction, so the
// races the review describes are reproduced deterministically.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FieldValue } from 'firebase-admin/firestore';
import { db, resetEmulators, seedPolicy, BUSINESS, num, Timestamp } from './harness';
import { sweepStaleVerificationJobs, sweepDeps } from '../src/verification/staleJobSweep';

async function codeJob(id: string, over: Record<string, unknown> = {}) {
  const data: Record<string, unknown> = {
    jobId: id, kind: 'phone_auth_otp', purpose: 'signin', businessId: BUSINESS, policyVersion: 1,
    status: 'queued', messageBody: 'code 123456', phoneE164: num(1), recipientCountryCode: 'PS',
    expiresAt: Timestamp.fromMillis(Date.now() + 300_000), ...over,
  };
  // `undefined` in `over` means "field absent" (e.g. a legacy job with no generation).
  await db().collection('relayJobs').doc(id).set(Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)));
}
const job = async (id: string) => (await db().collection('relayJobs').doc(id).get()).data()!;
const origHook = sweepDeps.beforeJobTx;

beforeEach(async () => { await resetEmulators(); await seedPolicy({ policyVersion: 1 }); });
afterEach(() => { sweepDeps.beforeJobTx = origHook; });

describe('N6 — stale-code cleanup is conditional on generation and fresh status', () => {
  it('after a policy bump, only old-generation queued work is cancelled; new-generation admissions survive', async () => {
    await codeJob('old-1'); await codeJob('old-2');
    await seedPolicy({ policyVersion: 2 });
    await codeJob('new-1', { policyVersion: 2 }); // admitted between the bump and the sweep
    const r = await sweepStaleVerificationJobs(db());
    expect(r).toMatchObject({ cancelled: 2, complete: true });
    expect(await job('old-1')).toMatchObject({ status: 'failed', lastError: 'policy-changed' });
    expect((await job('old-1')).messageBody).toBeUndefined();
    expect(await job('new-1')).toMatchObject({ status: 'queued', messageBody: 'code 123456' });
  });

  it('a job claimed (or sending) between the query and its transaction is never overwritten', async () => {
    await codeJob('race-claim'); await codeJob('race-sending');
    await seedPolicy({ policyVersion: 2 });
    sweepDeps.beforeJobTx = async id => {
      await db().collection('relayJobs').doc(id).update({ status: id === 'race-claim' ? 'claimed' : 'sending' });
    };
    const r = await sweepStaleVerificationJobs(db());
    expect(r.cancelled).toBe(0);
    expect((await job('race-claim')).status).toBe('claimed');
    expect((await job('race-sending')).status).toBe('sending');
  });

  it('a delivery report that lands first keeps its terminal state', async () => {
    await codeJob('race-delivered');
    await seedPolicy({ policyVersion: 2 });
    sweepDeps.beforeJobTx = async id => {
      await db().collection('relayJobs').doc(id).update({ status: 'delivered', deliveredAt: FieldValue.serverTimestamp(), messageBody: FieldValue.delete() });
    };
    await sweepStaleVerificationJobs(db());
    expect(await job('race-delivered')).toMatchObject({ status: 'delivered' });
    expect((await job('race-delivered')).lastError).toBeUndefined();
  });

  it('a policy rolled forward again mid-sweep is honoured per job (re-read in each transaction)', async () => {
    await codeJob('gen2', { policyVersion: 2 });
    await seedPolicy({ policyVersion: 3 });
    sweepDeps.beforeJobTx = async () => { await seedPolicy({ policyVersion: 2 }); }; // e.g. a revert lands first
    const r = await sweepStaleVerificationJobs(db());
    expect(r.cancelled).toBe(0);
    expect((await job('gen2')).status).toBe('queued');
  });

  it('paginates past 200 jobs; legacy public OTPs and expired codes are always cleared; business SMS untouched', async () => {
    await seedPolicy({ policyVersion: 2 });
    const writes: Array<Promise<unknown>> = [];
    for (let i = 0; i < 450; i++) writes.push(codeJob(`stale-${String(i).padStart(3, '0')}`));
    for (let i = 0; i < 30; i++) writes.push(codeJob(`valid-${i}`, { policyVersion: 2 }));
    writes.push(codeJob('legacy', { kind: 'otp', policyVersion: undefined }));
    writes.push(codeJob('expired', { policyVersion: 2, expiresAt: Timestamp.fromMillis(Date.now() - 1) }));
    writes.push(db().collection('relayJobs').doc('biz').set({ jobId: 'biz', businessId: BUSINESS, status: 'queued', messageBody: 'hello' }));
    const settled = await Promise.allSettled(writes); // never leak in-flight writes into the next test
    expect(settled.filter(x => x.status === 'rejected')).toEqual([]);
    const r = await sweepStaleVerificationJobs(db());
    expect(r).toMatchObject({ cancelled: 452, complete: true });
    const queued = await db().collection('relayJobs').where('status', '==', 'queued').get();
    expect(queued.docs.map(d => d.id).sort()).toEqual(['biz', ...Array.from({ length: 30 }, (_, i) => `valid-${i}`)].sort());
  });

  it('bounded runs report incompleteness and finish on the next run', async () => {
    await seedPolicy({ policyVersion: 2 });
    await Promise.all(Array.from({ length: 250 }, (_, i) => codeJob(`s-${i}`)));
    const first = await sweepStaleVerificationJobs(db(), 1);
    expect(first.complete).toBe(false);
    const second = await sweepStaleVerificationJobs(db(), 10);
    expect(first.cancelled + second.cancelled).toBe(250);
  });

  it('control: the reviewed unconditional bulk-cancel overwrote a claimed job and new-generation work', async () => {
    // The dashboard algorithm at 430dcfc: query queued codes, then batch-write
    // every snapshot to failed with no status/generation recheck.
    await codeJob('c-old');
    await seedPolicy({ policyVersion: 2 });
    await codeJob('c-new', { policyVersion: 2 });
    const snap = await db().collection('relayJobs').where('kind', '==', 'phone_auth_otp').where('status', '==', 'queued').get();
    await db().collection('relayJobs').doc('c-old').update({ status: 'claimed' }); // device claims it meanwhile
    const batch = db().batch();
    snap.docs.forEach(d => batch.update(d.ref, { status: 'failed', lastError: 'policy-changed', messageBody: FieldValue.delete() }));
    await batch.commit();
    expect((await job('c-old')).status).toBe('failed'); // claimed state overwritten
    expect((await job('c-new')).status).toBe('failed'); // valid new-generation code cancelled
  });
});
