import { describe, it, expect } from 'vitest';
import { localMessageId, localId, idempotencyKey, newDeviceId } from '../../src/localdb/sync/ids';

describe('id generation', () => {
  it('local message id embeds the device id and is unique', () => {
    const a = localMessageId('dev_123');
    const b = localMessageId('dev_123');
    expect(a.startsWith('local_msg_dev_123_')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('localId is namespaced by entity', () => {
    expect(localId('outbox').startsWith('local_outbox_')).toBe(true);
  });

  it('idempotencyKey is deterministic for the same natural key', () => {
    expect(idempotencyKey(['send', 'dev_1', 'local_msg_x'])).toBe('send:dev_1:local_msg_x');
    expect(idempotencyKey(['send', 'dev_1', 'local_msg_x']))
      .toBe(idempotencyKey(['send', 'dev_1', 'local_msg_x']));
  });

  it('idempotencyKey falls back to a random key when empty', () => {
    const k = idempotencyKey([null, undefined, '']);
    expect(k.startsWith('idem_')).toBe(true);
  });

  it('device ids are unique', () => {
    expect(newDeviceId()).not.toBe(newDeviceId());
  });
});
