import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSettingsSupportClient } from '../settings-support-client.js';

function fixture({ afterDelete, failSignOut } = {}) {
  const auth = { currentUser: { uid: 'owner' } };
  const calls = [];
  let feed;
  const client = createSettingsSupportClient({
    auth, db: 'db',
    sdk: {
      collection: (...args) => args,
      query: (...args) => args,
      where: (...args) => args,
      orderBy: (...args) => args,
      serverTimestamp: () => 'timestamp',
      async addDoc(source, data) { calls.push(['create', source, data]); return { id: 'ticket' }; },
      async signOut() {
        calls.push(['signOut']);
        if (failSignOut) throw new Error('sign-out-failed');
        auth.currentUser = null;
      },
    },
    watchScoped(uid, source, emit) {
      calls.push(['watch', uid, source]);
      feed = emit;
      return () => calls.push(['stop']);
    },
    requireSession(uid) { if (auth.currentUser?.uid !== uid) throw new Error('account-changed'); },
    async invoke(name, data) {
      calls.push([name, data]);
      return afterDelete ? afterDelete(auth) : { ok: true };
    },
  });
  return { client, calls, emit: snapshot => feed(snapshot) };
}

test('uses the mobile query and ticket format for the signed-in owner', () => {
  const { client, calls, emit } = fixture();
  const received = [];
  const stop = client.watchSupportTickets('owner', tickets => received.push(...tickets));
  const date = new Date('2026-11-15T12:00:00Z');
  emit({ docs: [{ id: 'ticket', data: () => ({ subject: 'Issue', createdAt: { toDate: () => date } }) }] });
  stop();
  assert.deepEqual(received, [{ id: 'ticket', subject: 'Issue', category: 'other', status: 'open', createdAt: date }]);
  assert.deepEqual(calls, [['watch', 'owner', [['db', 'tickets'], ['createdBy', '==', 'owner'], ['createdAt', 'desc']]], ['stop']]);
});

test('validates tickets and only creates an open ticket scoped to the confirmed account', async () => {
  const { client, calls } = fixture();
  const ticket = { subject: '  Charges  ', description: '  Missing payment  ', category: 'billing' };
  await assert.rejects(client.createSupportTicket('other', ticket), /account-changed/);
  await assert.rejects(client.createSupportTicket('owner', { ...ticket, subject: ' ' }), /support-ticket-invalid/);
  await assert.rejects(client.createSupportTicket('owner', { ...ticket, category: 'invalid' }), /support-ticket-invalid/);
  assert.equal(await client.createSupportTicket('owner', ticket), 'ticket');
  assert.deepEqual(calls, [['create', ['db', 'tickets'], {
    subject: 'Charges', description: 'Missing payment', category: 'billing',
    status: 'open', createdBy: 'owner', createdAt: 'timestamp', updatedAt: 'timestamp',
  }]]);
});

test('does not confuse a local sign-out error with a failed account deletion', async () => {
  const { client, calls } = fixture({ failSignOut: true });
  assert.deepEqual(await client.deleteOwnAccount('owner'), { signedOut: false });
  assert.deepEqual(calls, [['deleteMyAccount', { expectedUid: 'owner' }], ['signOut']]);
});

test('does not sign out an account that became active during account deletion', async () => {
  const { client, calls } = fixture({ afterDelete(auth) { auth.currentUser = { uid: 'different' }; return { ok: true }; } });
  await assert.rejects(client.deleteOwnAccount('different'), /account-changed/);
  assert.deepEqual(await client.deleteOwnAccount('owner'), { signedOut: true });
  assert.deepEqual(calls, [['deleteMyAccount', { expectedUid: 'owner' }]]);
});

test('leaves the browser session available if deletion was not confirmed', async () => {
  const { client, calls } = fixture({ afterDelete: () => ({ ok: false }) });
  await assert.rejects(client.deleteOwnAccount('owner'), /account-deletion-unconfirmed/);
  assert.deepEqual(calls, [['deleteMyAccount', { expectedUid: 'owner' }]]);
});
