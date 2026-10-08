// A21 — email OTP regressions for the shared helpers and the companion fixes
// (atomic reservation, budgets kept apart from the challenge, cleanup that
// commits, explicit Auth error handling). The email provider is mocked: no
// email is ever sent.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from 'firebase-admin/auth';

const sent: Array<{ to: string; text: string }> = [];
let failNext = false;
vi.mock('../src/lib/email', () => ({
  sendEmail: vi.fn(async (m: { to: string; text: string }) => {
    if (failNext) { failNext = false; throw new Error('provider down'); }
    sent.push(m);
  }),
}));

import { db, resetEmulators, req, expectHttps, authUserCount } from './harness';
import { requestEmailOtp } from '../src/auth/requestEmailOtp';
import { verifyEmailOtp } from '../src/auth/verifyEmailOtp';

const EMAIL = 'person@example.test';
const lastCode = () => /\b(\d{6})\b/.exec(sent[sent.length - 1]?.text ?? '')?.[1] ?? '';
const request = (email = EMAIL) => requestEmailOtp.run(req(null, { email }));
const verify = (code: string, email = EMAIL) => verifyEmailOtp.run(req(null, { email, code })) as Promise<{ uid: string }>;
const challenge = async () => (await db().collection('emailOtpChallenges').get()).docs[0] ?? null;

beforeEach(async () => {
  await resetEmulators();
  sent.length = 0;
  failNext = false;
  await db().collection('systemSettings').doc('general').set({ emailSignInEnabled: true });
});

describe('email OTP', () => {
  it('parallel requests reserve one send (no shared-allowance race)', async () => {
    const rs = await Promise.allSettled(Array.from({ length: 10 }, () => request()));
    expect(rs.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it('a successful sign-in does not reset the send budget', async () => {
    await request();
    await verify(lastCode());
    await expectHttps(request(), 'resource-exhausted', 'otp-cooldown');
    expect((await db().collection('emailOtpLimits').get()).size).toBe(1);
  });

  it('expiry and lockout cleanup actually commit (no transaction rollback)', async () => {
    await request();
    const ref = (await challenge())!.ref;
    for (let i = 0; i < 5; i++) await expectHttps(verify(lastCode() === '000000' ? '111111' : '000000'), 'permission-denied', 'otp-incorrect');
    await expectHttps(verify(lastCode()), 'resource-exhausted', 'otp-too-many-attempts');
    expect((await ref.get()).exists).toBe(false);
  });

  it('expired codes are deleted on use', async () => {
    await request();
    const ref = (await challenge())!.ref;
    await ref.update({ expiresAt: new Date(Date.now() - 1000) });
    await expectHttps(verify(lastCode()), 'deadline-exceeded', 'otp-expired');
    expect((await ref.get()).exists).toBe(false);
  });

  it('a provider failure voids the code and keeps the reservation (conservative)', async () => {
    failNext = true;
    await expectHttps(request(), 'unavailable', 'email-send-failed');
    expect((await challenge())!.get('status')).toBe('send-failed');
    await expectHttps(verify('123456'), 'failed-precondition', 'otp-not-requested');
    await expectHttps(request(), 'resource-exhausted', 'otp-cooldown');
  });

  it('an Auth error other than user-not-found never creates a second account', async () => {
    await request();
    const auth = getAuth();
    const spy = vi.spyOn(auth, 'getUserByEmail').mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'auth/internal-error' }));
    const before = await authUserCount();
    await expectHttps(verify(lastCode()), 'unavailable', 'signin-interrupted');
    expect(await authUserCount()).toBe(before);
    spy.mockRestore();
  });

  it('happy path still works: new account once, then the same account', async () => {
    await request();
    const a = await verify(lastCode());
    const users = await authUserCount();
    await db().collection('emailOtpLimits').get().then(s => Promise.all(s.docs.map(d => d.ref.delete())));
    await request();
    const b = await verify(lastCode());
    expect(b.uid).toBe(a.uid);
    expect(await authUserCount()).toBe(users);
  });
});
