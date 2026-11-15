import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { outputFiles: [clientModule] } = await build({
  entryPoints: [fileURLToPath(new URL('../firebase-client.js', import.meta.url))],
  bundle: true,
  format: 'esm',
  tsconfigRaw: { compilerOptions: {} },
  write: false,
});
const { initializeFirebaseClient } = await import(
  `data:text/javascript;base64,${Buffer.from(clientModule.contents).toString('base64')}`
);

function fixture(profile, { beforeRead, claimError } = {}) {
  const auth = { currentUser: { uid: 'owner' } };
  const writes = [];
  let emitAccount;
  const sdk = {
    initializeApp: () => ({}),
    initializeAuth: () => auth,
    initializeFirestore: () => 'db',
    memoryLocalCache: () => ({}),
    getFunctions: () => ({}),
    getStorage: () => ({}),
    doc: (...path) => path,
    async getDocFromServer(path) {
      assert.deepEqual(path, ['db', 'users', 'owner']);
      beforeRead?.(auth);
      return { data: () => profile };
    },
    serverTimestamp: () => 'server timestamp',
    onSnapshot(_, __, observe) {
      emitAccount = (data, metadata) => observe({ id: 'owner', data: () => data, exists: () => true, metadata });
      return () => {};
    },
    async updateDoc(path, data) { writes.push(['updateDoc', path, data]); },
    ref: (_, path) => path,
    async uploadBytes(path, file) { writes.push(['uploadBytes', path, file.type]); },
    async getDownloadURL() { return 'https://firebasestorage.googleapis.com/avatar?token=fixture'; },
    httpsCallable: (_, name) => async data => {
      writes.push([name, data]);
      if (claimError) throw claimError;
      return { data: { username: data.username } };
    },
  };
  return { client: initializeFirebaseClient(sdk, {}), writes, emitAccount: (...args) => emitAccount(...args) };
}

test('updates only the owner display name even without a username', async () => {
  const { client, writes } = fixture({ displayName: 'Original', about: 'Existing bio' });
  assert.deepEqual(await client.updateOwnProfile({ displayName: '  رائد رشيد  ' }), { displayName: 'رائد رشيد' });
  assert.deepEqual(writes, [
    ['updateDoc', ['db', 'users', 'owner'], { displayName: 'رائد رشيد', updatedAt: 'server timestamp' }],
  ]);
});

test('claims the new username with the latest display name and existing bio', async () => {
  const { client, writes } = fixture({ displayName: 'Current name', about: 'Existing bio', username: 'previous.handle' });
  const result = await client.updateOwnProfile({ username: ' New.Handle ' });
  assert.deepEqual(result, { displayName: 'Current name', username: 'new.handle' });
  assert.deepEqual(writes, [
    ['claimUsername', { displayName: 'Current name', username: 'new.handle', about: 'Existing bio' }],
  ]);
});

test('sends both names in one claim and propagates a duplicate username error', async () => {
  const error = Object.assign(new Error('username-taken'), { code: 'functions/already-exists' });
  const { client, writes } = fixture({ displayName: 'Original' }, { claimError: error });
  await assert.rejects(client.updateOwnProfile({ displayName: 'Changed', username: 'taken.handle' }), error);
  assert.deepEqual(writes, [
    ['claimUsername', { displayName: 'Changed', username: 'taken.handle', about: null }],
  ]);
});

test('stops a save if the authenticated user changes while loading the profile', async () => {
  const { client, writes } = fixture({ displayName: 'Original' }, {
    beforeRead(auth) { auth.currentUser = { uid: 'other-account' }; },
  });
  await assert.rejects(client.updateOwnProfile({ username: 'new.handle' }), { code: 'account-changed' });
  assert.deepEqual(writes, []);
});

test('keeps pending local edits out of the authoritative account snapshot', () => {
  const { client, emitAccount } = fixture();
  const names = [];
  client.watchAccount('owner', profile => names.push(profile.displayName));
  emitAccount({ displayName: 'Original' }, { fromCache: false });
  emitAccount({ displayName: 'Pending' }, { hasPendingWrites: true });
  emitAccount({ displayName: 'Confirmed' }, { fromCache: false });
  assert.deepEqual(names, ['Original', 'Confirmed']);
});

test('writes only supported appearance preferences to the authenticated profile', async () => {
  const { client, writes } = fixture();
  await assert.rejects(client.updateAccountAppearance({ username: 'other' }), { code: 'invalid-preference' });
  await assert.rejects(client.updateAccountAppearance({ preferredTheme: 'purple' }), { code: 'invalid-preference' });
  await client.updateAccountAppearance({ preferredTheme: 'light', timeFormat: '24h' });
  assert.deepEqual(writes, [
    ['updateDoc', ['db', 'users', 'owner'], { preferredTheme: 'light', timeFormat: '24h', updatedAt: 'server timestamp' }],
  ]);
});

test('updates the current avatar with a fresh image URL and leaves other profile fields alone', async () => {
  const { client, writes } = fixture();
  await assert.rejects(client.updateOwnPhoto({ type: 'image/svg+xml', size: 1 }), { code: 'invalid-profile-photo' });
  const photoURL = await client.updateOwnPhoto({ type: 'image/webp', size: 1000 });
  const photo = new URL(photoURL);
  assert.equal(photo.searchParams.get('token'), 'fixture');
  assert.ok(photo.searchParams.get('v'));
  assert.deepEqual(writes, [
    ['uploadBytes', 'avatars/owner/avatar-web.webp', 'image/webp'],
    ['updateDoc', ['db', 'users', 'owner'], { photoURL, updatedAt: 'server timestamp' }],
  ]);
});
