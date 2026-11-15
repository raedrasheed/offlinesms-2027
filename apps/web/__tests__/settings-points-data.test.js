import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSettingsPointsData } from '../settings-points-data.js';

function document(id, data) {
  return { id, data: () => data };
}

function fixtures(snapshot = { docs: [] }) {
  let active = 'owner';
  let watch;
  let read;
  const client = createSettingsPointsData({
    sdk: {
      doc: (_, ...path) => path, collection: (_, ...path) => path,
      query: (source, ...clauses) => ({ source, clauses }),
      where: (...values) => ['where', ...values], orderBy: (...values) => ['orderBy', ...values],
      limit: n => ['limit', n], getDocsFromServer: async source => { read = source; return snapshot; },
    },
    db: {}, documentId: value => value,
    requireSession: uid => { if (uid !== active) throw Error('account-changed'); },
    watchScoped: (uid, source, emit) => {
      if (uid !== active) throw Error('account-changed');
      watch = { source, emit };
      return () => { watch = undefined; };
    },
  });
  return { client, watch: () => watch, read: () => read, switchUser: uid => { active = uid; } };
}

test('wallet subtracts reservations and provides the documented zero balance for a missing wallet', () => {
  const { client, watch } = fixtures();
  const values = [];
  const stop = client.watchPointsWallet('owner', value => values.push(value));
  assert.deepEqual(watch().source, ['wallets', 'owner']);
  watch().emit(document('owner', { balance: 80, reserved: 30, status: 'frozen' }));
  watch().emit(document('owner', undefined));
  stop();
  assert.equal(watch(), undefined);
  assert.deepEqual(values, [
    { balance: 80, reserved: 30, available: 50, status: 'frozen' },
    { balance: 0, reserved: 0, available: 0, status: 'active' },
  ]);
});

test('transactions and requests are scoped to their owner and retain native legacy fields', () => {
  const { client, watch } = fixtures();
  let items;
  client.watchPointsTransactions('owner', value => { items = value; });
  assert.deepEqual(watch().source.clauses, [['where', 'userId', '==', 'owner'], ['orderBy', 'createdAt', 'desc'], ['limit', 25]]);
  watch().emit({ docs: [document('entry', { type: 'sms', amount: -20, batchId: 'batch' })] });
  assert.equal(items[0].type, 'sms_spend');
  assert.equal(items[0].direction, 'debit');
  assert.equal(items[0].amount, 20);
  assert.equal(items[0].relatedSmsBatchId, 'batch');
  client.watchPointsRequests('owner', value => { items = value; });
  assert.deepEqual(watch().source.clauses, [['where', 'userId', '==', 'owner'], ['limit', 50]]);
  watch().emit({ docs: [document('older', { createdAt: { toMillis: () => 10 } }), document('newer', { createdAt: { toMillis: () => 20 } })] });
  assert.deepEqual(items.map(entry => entry.id), ['newer', 'older']);
  assert.throws(() => client.watchPointsRequests('other', () => {}), /account-changed/);
});

test('prefix lookup excludes self and disabled users and drops late account changes', async () => {
  const { client, read, switchUser } = fixtures({ docs: [
    document('owner', { username: 'alex' }),
    document('person', { username: 'alex.other', displayName: 'Alex', email: 'ignored@example.test' }),
    document('blocked', { username: 'alex.locked', status: 'disabled' }),
  ] });
  assert.deepEqual(await client.searchPointsRecipients('owner', '@Alex'), [
    { uid: 'person', username: 'alex.other', displayName: 'Alex' },
  ]);
  assert.deepEqual(read().clauses, [['orderBy', 'usernameLower'], ['where', 'usernameLower', '>=', 'alex'],
    ['where', 'usernameLower', '<=', 'alex\uf8ff'], ['limit', 20]]);
  const pending = client.searchPointsRecipients('owner', '@Alex');
  switchUser('other');
  await assert.rejects(pending, /account-changed/);
});

test('SMS recipients expose only their masked number and delivery metadata', () => {
  const { client, watch } = fixtures();
  let recipients;
  client.watchPointsSmsRecipients('owner', 'batch', value => { recipients = value; });
  assert.deepEqual(watch().source, ['smsBatches', 'batch', 'recipients']);
  watch().emit({ docs: [document('row', { phoneE164: '+123456789', maskedPhone: '+123***789', smsStatus: 'failed' })] });
  assert.deepEqual(recipients, [{ uid: 'row', maskedPhone: '+123***789', smsStatus: 'failed' }]);
});
