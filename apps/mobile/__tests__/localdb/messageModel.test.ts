import { describe, it, expect } from 'vitest';
import { mapMessageRow, mapAndOrderMessages, effectiveTimeMs } from '../../src/hooks/messageModel';
import type { MessageRow } from '../../src/localdb/types';

function row(p: Partial<MessageRow>): MessageRow {
  return {
    id: 'm1', local_id: null, remote_id: null, conversation_id: 'c1',
    sender_uid: 'u1', sender_display_name: null, type: 'text', text: 'hi',
    preview: 'hi', created_at: 1000, remote_created_at: null, updated_at: 1000,
    edited_at: null, deleted_for_everyone: 0, deleted_for_me: 0, deleted_at: null,
    reply_to_message_id: null, reply_to_preview: null, forwarded: 0,
    forwarded_from_message_id: null, status: 'sent', error_code: null,
    error_message: null, sync_status: 'synced', client_sequence: 0, server_version: 0,
    reactions_json: null, delivered_count: 0, read_count: 0, viewed_count: 0, played_count: 0,
    ...p,
  };
}

describe('effectiveTimeMs', () => {
  it('prefers remote_created_at over created_at', () => {
    expect(effectiveTimeMs(row({ created_at: 1000, remote_created_at: 2000 }))).toBe(2000);
    expect(effectiveTimeMs(row({ created_at: 1000, remote_created_at: null }))).toBe(1000);
  });
});

describe('mapMessageRow', () => {
  it('maps core text-message fields', () => {
    const m = mapMessageRow(row({ remote_id: 'r1', text: 'hello', sender_display_name: 'Raed', remote_created_at: 5000 }));
    expect(m.id).toBe('r1');
    expect(m.text).toBe('hello');
    expect(m.senderUid).toBe('u1');
    expect(m.senderDisplayName).toBe('Raed');
    expect(m.deletedForEveryone).toBe(false);
    expect(m.createdAt.toMillis()).toBe(5000);
  });

  it('falls back to local_id for pending messages and maps pending→sending', () => {
    const m = mapMessageRow(row({ remote_id: null, local_id: 'local_msg_x', status: 'pending' }));
    expect(m.id).toBe('local_msg_x');
    expect(m.status).toBe('sending');
  });

  it('maps replyTo from the stored message id + preview', () => {
    const m = mapMessageRow(row({ reply_to_message_id: 'r0', reply_to_preview: 'earlier' }));
    expect(m.replyTo?.messageId).toBe('r0');
    expect(m.replyTo?.preview).toBe('earlier');
  });

  it('marks deleted-for-everyone and forwarded flags', () => {
    const m = mapMessageRow(row({ deleted_for_everyone: 1, forwarded: 1 }));
    expect(m.deletedForEveryone).toBe(true);
    expect(m.forwarded).toBe(true);
  });

  it('parses the reactions JSON map', () => {
    const m = mapMessageRow(row({ reactions_json: JSON.stringify({ '👍': ['u1', 'u2'], '❤️': ['u3'] }) }));
    expect(m.reactions).toEqual({ '👍': ['u1', 'u2'], '❤️': ['u3'] });
  });

  it('returns null reactions for empty/invalid JSON', () => {
    expect(mapMessageRow(row({ reactions_json: null })).reactions).toBeNull();
    expect(mapMessageRow(row({ reactions_json: 'not json' })).reactions).toBeNull();
  });

  it('maps receipt aggregate counts', () => {
    const m = mapMessageRow(row({ delivered_count: 5, read_count: 3, viewed_count: 1, played_count: 0 }));
    expect(m.deliveredCount).toBe(5);
    expect(m.readCount).toBe(3);
    expect(m.viewedCount).toBe(1);
    expect(m.playedCount).toBe(0);
  });
});

describe('mapAndOrderMessages', () => {
  it('orders ascending by effective time', () => {
    const out = mapAndOrderMessages([
      row({ id: 'b', remote_id: 'b', remote_created_at: 3000 }),
      row({ id: 'a', remote_id: 'a', remote_created_at: 1000 }),
      row({ id: 'c', local_id: 'c', remote_created_at: null, created_at: 2000 }),
    ]);
    expect(out.map(m => m.id)).toEqual(['a', 'c', 'b']);
  });
});
