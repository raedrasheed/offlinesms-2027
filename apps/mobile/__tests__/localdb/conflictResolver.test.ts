import { describe, it, expect } from 'vitest';
import {
  mergeReceiptStatus,
  resolveMessageConflict,
  matchesPendingLocal,
  type MessageSnapshot,
} from '../../src/localdb/sync/conflictResolver';

describe('mergeReceiptStatus (monotonic)', () => {
  it('never downgrades', () => {
    expect(mergeReceiptStatus('read', 'delivered')).toBe('read');
    expect(mergeReceiptStatus('delivered', 'pending')).toBe('delivered');
    expect(mergeReceiptStatus('played', 'read')).toBe('played');
  });
  it('upgrades to a higher status', () => {
    expect(mergeReceiptStatus('pending', 'delivered')).toBe('delivered');
    expect(mergeReceiptStatus('delivered', 'read')).toBe('read');
    expect(mergeReceiptStatus('read', 'played')).toBe('played');
  });
  it('a real delivery signal beats a prior failed', () => {
    expect(mergeReceiptStatus('failed', 'delivered')).toBe('delivered');
    expect(mergeReceiptStatus('failed', 'read')).toBe('read');
  });
  it('failed only stands over pending', () => {
    expect(mergeReceiptStatus('pending', 'failed')).toBe('failed');
    expect(mergeReceiptStatus('delivered', 'failed')).toBe('delivered');
  });
});

function snap(p: Partial<MessageSnapshot>): MessageSnapshot {
  return { text: 'x', editedAt: null, deletedForEveryone: false, remoteCreatedAt: 1000, serverVersion: 0, ...p };
}

describe('resolveMessageConflict', () => {
  it('remote delete-for-everyone wins', () => {
    expect(resolveMessageConflict(snap({}), snap({ deletedForEveryone: true })).action).toBe('delete-for-everyone');
  });
  it('higher server version wins', () => {
    expect(resolveMessageConflict(snap({ serverVersion: 1 }), snap({ serverVersion: 2 })).action).toBe('take-remote');
    expect(resolveMessageConflict(snap({ serverVersion: 3 }), snap({ serverVersion: 2 })).action).toBe('keep-local');
  });
  it('newer edit wins at equal version', () => {
    expect(resolveMessageConflict(snap({ editedAt: 10 }), snap({ editedAt: 20 })).action).toBe('take-remote');
    expect(resolveMessageConflict(snap({ editedAt: 30 }), snap({ editedAt: 20 })).action).toBe('keep-local');
  });
  it('local delete-for-everyone is preserved against a normal remote', () => {
    expect(resolveMessageConflict(snap({ deletedForEveryone: true }), snap({})).action).toBe('keep-local');
  });
});

describe('matchesPendingLocal', () => {
  it('matches when ids equal and both present', () => {
    expect(matchesPendingLocal('local_msg_1', 'local_msg_1')).toBe(true);
    expect(matchesPendingLocal('local_msg_1', 'local_msg_2')).toBe(false);
    expect(matchesPendingLocal(null, 'local_msg_1')).toBe(false);
    expect(matchesPendingLocal('local_msg_1', undefined)).toBe(false);
  });
});
