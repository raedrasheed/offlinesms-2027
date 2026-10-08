// A21 — email OTP regressions for the shared helpers and the companion fixes
// (atomic reservation, budgets kept apart from the challenge, cleanup that
// commits, explicit Auth error handling). The email provider is mocked: no
// email is ever sent.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from 'firebase-admin/auth';

const sent: Array<{ to: string; text: string }> = [];
let failNext = false;
// N7: when `defer` is set, each provider call parks until the test settles it.
let defer = false;
const parked: Array<{ text: string; ok: () => void; fail: () => void }> = [];
vi.mock('../src/lib/email', () => ({
  sendEmail: vi.fn(async (m: { to: string; text: string }) => {
    if (defer) {
      return new Promise<void>((resolve, reject) => parked.push({
        text: m.text, ok: () => { sent.push(m); resolve(); }, fail: () => reject(new Error('provider down')),
      }));
    }
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
  defer = false;
  parked.length = 0;
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

describe('N7 — a late provider result never changes a newer challenge', () => {
  const codeOf = (text: string) => /\b(\d{6})\b/.exec(text)?.[1] ?? '';
  const status = async () => (await challenge())!.get('status');
  const clearBudget = () => db().collection('emailOtpLimits').get().then(s => Promise.all(s.docs.map(d => d.ref.delete())));

  /** Start generation 1, then generation 2 (budget cleared in between), both parked at the provider. */
  async function twoGenerations() {
    defer = true;
    const g1 = request().then(() => 'ok', (e: { message?: string }) => e.message);
    await vi.waitFor(() => expect(parked).toHaveLength(1));
    await clearBudget();
    const g2 = request().then(() => 'ok', (e: { message?: string }) => e.message);
    await vi.waitFor(() => expect(parked).toHaveLength(2));
    expect(await status()).toBe('sending');
    return { g1, g2, older: parked[0], newer: parked[1] };
  }

  const cases = [
    { older: 'ok', newer: 'fail', olderFirst: true },
    { older: 'ok', newer: 'fail', olderFirst: false },
    { older: 'fail', newer: 'ok', olderFirst: true },
    { older: 'fail', newer: 'ok', olderFirst: false },
  ] as const;
  for (const c of cases) {
    it(`older ${c.older} / newer ${c.newer}, older settles ${c.olderFirst ? 'first' : 'last'}: only the newer outcome counts`, async () => {
      const { g1, g2, older, newer } = await twoGenerations();
      const settle = async (p: typeof older, how: 'ok' | 'fail', done: Promise<unknown>) => { p[how](); await done; };
      if (c.olderFirst) {
        await settle(older, c.older, g1);
        expect(await status()).toBe('sending'); // the older result changed nothing
        await settle(newer, c.newer, g2);
      } else {
        await settle(newer, c.newer, g2);
        await settle(older, c.older, g1);
      }
      expect(await status()).toBe(c.newer === 'ok' ? 'pending' : 'send-failed');
      // The older generation's code never verifies, whatever its provider said.
      await expectHttps(verify(codeOf(older.text)), c.newer === 'ok' ? 'permission-denied' : 'failed-precondition');
      if (c.newer === 'ok') await expect(verify(codeOf(newer.text))).resolves.toMatchObject({ uid: expect.any(String) });
    });
  }
});
