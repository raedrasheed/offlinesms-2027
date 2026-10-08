// The remediation script (scripts/remediatePhoneOtpAbuse.ts) against seeded
// leftovers on the emulator: dry-run changes nothing; --apply neutralizes
// legacy OTP jobs/challenges and (only when asked) redacts audit targets.

import { beforeEach, describe, expect, it } from 'vitest';
import { getAuth } from 'firebase-admin/auth';
import { db, resetEmulators, BUSINESS, num, Timestamp } from './harness';
import { runRemediation } from '../../scripts/remediatePhoneOtpAbuse';

async function seedLeftovers() {
  const jobs = db().collection('relayJobs');
  await jobs.doc('otp_a').set({ kind: 'otp', businessId: BUSINESS, status: 'queued', messageBody: 'code 111111', phoneE164: num(1) });
  await jobs.doc('otp_b').set({ kind: 'otp', businessId: BUSINESS, status: 'claimed', messageBody: 'code 222222', phoneE164: num(2) });
  await jobs.doc('otp_c').set({ kind: 'otp', businessId: BUSINESS, status: 'failed', messageBody: 'code 333333', phoneE164: num(3) });
  await jobs.doc('otp_d').set({ kind: 'otp', businessId: BUSINESS, status: 'sent', phoneE164: num(4) });
  await jobs.doc('sms_x').set({ kind: 'sms', businessId: BUSINESS, status: 'queued', messageBody: 'hello', phoneE164: num(5) });
  await db().collection('otpChallenges').doc('970599100001').set({ codeHash: 'h', salt: 's' });
  await db().collection('otpChallenges').doc('970599100002').set({ codeHash: 'h', salt: 's' });
  await db().collection('auditLogs').add({ action: 'auth.otp.requested', targetType: 'phone', targetId: '970599100001', createdAt: Timestamp.fromMillis(Date.UTC(2026, 8, 20)) });
  await db().collection('auditLogs').add({ action: 'auth.otp.verified', targetType: 'phone', targetId: '970599100002', createdAt: Timestamp.fromMillis(Date.UTC(2026, 8, 21)) });
  await getAuth().createUser({ phoneNumber: num(9) });
  await getAuth().createUser({ email: 'x@example.test' });
}

describe('remediation script', () => {
  beforeEach(async () => { await resetEmulators(); await seedLeftovers(); });

  it('dry-run reports counts only and changes nothing', async () => {
    const before = JSON.stringify((await db().collection('relayJobs').get()).docs.map(d => d.data()));
    const r = await runRemediation(db(), getAuth(), { apply: false, redactAudit: false, sinceMs: null });
    expect(r).toMatchObject({
      mode: 'dry-run', otpChallenges: 2, otpJobsWithBody: 3, otpAuditRows: 2, otpAuditRowsWithRawPhone: 2, phoneOnlyAuthUsersSince: 1,
      applied: { jobsCancelled: 0, bodiesPurged: 0, challengesDeleted: 0, auditRedacted: 0 },
    });
    expect(r.otpJobsByStatus).toEqual({ queued: 1, claimed: 1, failed: 1, sent: 1 });
    expect(JSON.stringify(r)).not.toMatch(/599100|111111|@example/);
    expect(JSON.stringify((await db().collection('relayJobs').get()).docs.map(d => d.data()))).toBe(before);
    expect((await db().collection('otpChallenges').get()).size).toBe(2);
  });

  it('--apply cancels in-flight OTP jobs, purges bodies, deletes challenges; leaves other jobs and audit alone', async () => {
    const r = await runRemediation(db(), getAuth(), { apply: true, redactAudit: false, sinceMs: null });
    expect(r.applied).toEqual({ jobsCancelled: 2, bodiesPurged: 1, challengesDeleted: 2, auditRedacted: 0 });
    for (const id of ['otp_a', 'otp_b']) {
      const j = await db().collection('relayJobs').doc(id).get();
      expect(j.get('status')).toBe('failed');
      expect(j.get('messageBody')).toBeUndefined();
    }
    expect((await db().collection('relayJobs').doc('otp_c').get()).get('messageBody')).toBeUndefined();
    expect((await db().collection('relayJobs').doc('sms_x').get()).get('status')).toBe('queued');
    expect((await db().collection('otpChallenges').get()).size).toBe(0);
    const audit = (await db().collection('auditLogs').get()).docs.map(d => d.get('targetId'));
    expect(audit).toContain('970599100001');
    expect((await getAuth().listUsers()).users).toHaveLength(2); // never deletes users
    // Idempotent.
    const again = await runRemediation(db(), getAuth(), { apply: true, redactAudit: false, sinceMs: null });
    expect(again.applied).toEqual({ jobsCancelled: 0, bodiesPurged: 0, challengesDeleted: 0, auditRedacted: 0 });
  });

  it('--redact-audit refuses to run without a forensic copy (or an explicit opt-out)', async () => {
    await expect(runRemediation(db(), getAuth(), { apply: true, redactAudit: true, sinceMs: null })).rejects.toThrow(/forensic/);
    const ids = (await db().collection('auditLogs').get()).docs.map(d => String(d.get('targetId')));
    expect(ids).toContain('970599100001'); // untouched
  });

  it('--redact-audit exports the raw rows first, then redacts', async () => {
    let exported: Array<Record<string, unknown>> = [];
    const r = await runRemediation(db(), getAuth(), {
      apply: true, redactAudit: true, sinceMs: null, forensicExport: async rows => { exported = rows; },
    });
    expect(r.forensicRowsExported).toBe(2);
    expect(exported.map(x => x.targetId).sort()).toEqual(['970599100001', '970599100002']);
    const ids = (await db().collection('auditLogs').get()).docs.map(d => String(d.get('targetId')));
    expect(ids.join(',')).not.toMatch(/599100/);
  });

  it('reports claimed/sending legacy jobs as possibly already on a device', async () => {
    const r = await runRemediation(db(), getAuth(), { apply: false, redactAudit: false, sinceMs: null });
    expect(r.inFlightPossiblyOnDevice).toBe(1);
  });
});
