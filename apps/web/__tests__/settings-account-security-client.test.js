import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../settings-account-security-client.js', import.meta.url))],
  bundle: true,
  format: 'esm',
  tsconfigRaw: { compilerOptions: {} },
  write: false,
});
const { createSettingsAccountSecurityClient } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString('base64')}`
);

const owner = 'account-one';
const mockCustomToken = uid => `header.${Buffer.from(JSON.stringify({ uid })).toString('base64url')}.signature`;

function fixture({ answers = {}, beforeSignIn } = {}) {
  const auth = { currentUser: { uid: owner } };
  const requests = [];
  const writes = [];
  const loggedIn = [];
  let middleware;
  const sdk = {
    beforeAuthStateChanged(_, fn) {
      middleware = fn;
      return () => { middleware = undefined; };
    },
    async signInWithCustomToken(_, token) {
      beforeSignIn?.(auth, middleware);
      const next = { uid: JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).uid };
      middleware(next);
      loggedIn.push(next.uid);
      auth.currentUser = next;
    },
    doc: (_, ...path) => path,
    async setDoc(ref, value, options) { writes.push({ ref, value, options }); },
    serverTimestamp: () => 'server timestamp',
  };
  const request = (name, payload, options) => {
    requests.push({ name, payload, options });
    return Promise.resolve(answers[name]);
  };
  const { settingsAccountSecurity } = createSettingsAccountSecurityClient({
    sdk, db: {}, auth,
    requireSession(uid) {
      if (auth.currentUser?.uid !== uid) throw new Error('account-changed');
    },
    invoke: request, call: request, useAppCheck: true,
  });
  return { security: settingsAccountSecurity(owner), requests, writes, loggedIn };
}

test('email change renewal takes only a custom token for the current UID', async () => {
  const good = fixture({ answers: {
    verifyEmailChangeCode: { email: 'example@example.test', customToken: mockCustomToken(owner) },
  } });
  assert.deepEqual(await good.security.verifyEmail('challenge-1', '654321'), {
    email: 'example@example.test', maskedEmail: undefined,
  });
  assert.deepEqual(good.loggedIn, [owner]);
  assert.deepEqual(good.requests[0].payload, { challengeId: 'challenge-1', code: '654321' });

  const bad = fixture({ answers: { resumeEmailChange: { customToken: mockCustomToken('other-account') } } });
  await assert.rejects(() => bad.security.resumeEmail('challenge-1'), /account-mismatch/);
  assert.deepEqual(bad.loggedIn, []);
});

test('email confirmation stays on the current account and cannot revive a signed-out session', async () => {
  for (const [uid, beforeSignIn, message] of [
    ['other-account', undefined, /account-mismatch/],
    [owner, (auth, guard) => { guard(null); auth.currentUser = null; }, /account-changed/],
  ]) {
    const item = fixture({ answers: { verifyEmailOtp: { uid, customToken: mockCustomToken(uid) } }, beforeSignIn });
    await item.security.sendConfirmation('email', 'me@example.test');
    await assert.rejects(() => item.security.verifyConfirmation('654321'), message);
    assert.deepEqual(item.loggedIn, []);
    assert.deepEqual(item.requests.map(({ name }) => name), ['requestEmailOtp', 'verifyEmailOtp']);
  }
});

test('SMS confirmation solves the existing proof and requests replay-protected App Check tokens', async () => {
  const expiresAtMs = Date.now() + 120000;
  const pow = { nonce: 'test-nonce', bits: 0, expiresAtMs };
  const item = fixture({ answers: {
    startPhoneAuth: { sessionToken: 'test-session', expiresAtMs, pow },
    requestPhoneAuthCode: { challengeId: 'fixture-challenge', pow, maskedPhone: '+970•••123' },
    verifyPhoneAuthCode: { uid: owner, customToken: mockCustomToken(owner) },
  } });
  await item.security.sendConfirmation('phone', '+970599123456');
  await item.security.verifyConfirmation('123456');
  assert.deepEqual(item.requests.map(({ name }) => name), ['startPhoneAuth', 'requestPhoneAuthCode', 'verifyPhoneAuthCode']);
  assert.equal(item.requests[1].payload.powSolution, '0');
  assert.equal(item.requests[2].payload.challengeId, 'fixture-challenge');
  assert.deepEqual(item.requests.slice(1).map(({ options }) => options),
    [{ limitedUseAppCheckTokens: true }, { limitedUseAppCheckTokens: true }]);
  assert.deepEqual(item.loggedIn, [owner]);
});

test('PIN settings write a native-compatible salted hash to the owner’s private profile', async () => {
  const item = fixture();
  await assert.rejects(() => item.security.setPin('12345'), /pin-must-be-6-digits/);
  assert.deepEqual(item.writes, []);
  await item.security.setPin('012345');
  const [write] = item.writes;
  assert.deepEqual(write.ref, ['users', owner, 'userPrivate', 'profile']);
  assert.deepEqual(write.options, { merge: true });
  assert.match(write.value.pinSalt, /^[a-f0-9]{32}$/);
  const pinHash = createHash('sha256').update(`${write.value.pinSalt}:012345`).digest('hex');
  assert.deepEqual(write.value, { pinSalt: write.value.pinSalt, pinHash, pinSetAt: 'server timestamp' });
});
