import { describe, expect, it, vi } from 'vitest';
import { createNotificationDismissal, type PresentedNotice } from '../src/lib/notificationDismissal';

function notice(id: string, conversationId: string, messageId: string, date = 100, type = 'chat_message'): PresentedNotice {
  return { date, request: { identifier: id, content: { data: { type, conversationId, messageId } } } };
}

describe('notification tray after reading a chat', () => {
  it('clears only the read chat; retains other chats, action notices and later arrivals', async () => {
    const dismiss = vi.fn(async (_id: string) => {});
    const clear = createNotificationDismissal({ dismiss, list: async () => [
      notice('read1', 'c1', 'm1'), notice('read2', 'c1', 'm2'),
      notice('other', 'c2', 'm3'), notice('later', 'c1', 'm4', 201),
      notice('join-request', 'c1', 'x', 100, 'group_join_request'),
      notice('admin', 'c1', 'x', 100, 'admin_broadcast'),
    ] });
    await clear('c1', { readAt: 200 });
    expect(dismiss.mock.calls.map(call => call[0])).toEqual(['read1', 'read2']);
  });

  it('clears only actually seen messages while browsing older history', async () => {
    const dismiss = vi.fn(async (_id: string) => {});
    const clear = createNotificationDismissal({ dismiss, list: async () => [notice('old', 'c1', 'm1'), notice('new', 'c1', 'm2')] });
    await clear('c1', { messageIds: ['m1'], readAt: 200 });
    expect(dismiss).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledWith('old');
  });

  it('does nothing if the user leaves while native enumeration is pending', async () => {
    let active = true;
    let finish!: (notices: PresentedNotice[]) => void;
    const dismiss = vi.fn(async () => {});
    const clear = createNotificationDismissal({ dismiss, list: () => new Promise(resolve => { finish = resolve; }) });
    const pending = clear('c1', { readAt: 200, isActive: () => active });
    active = false;
    finish([notice('kept', 'c1', 'm1')]);
    await pending;
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('does not interrupt chat reading if a tray item has disappeared or the platform fails', async () => {
    const clear = createNotificationDismissal({ dismiss: async () => { throw new Error('gone'); }, list: async () => [notice('gone', 'c1', 'm')] });
    await expect(clear('c1', { readAt: 200 })).resolves.toBeUndefined();
    const unavailable = createNotificationDismissal({ dismiss: async () => {}, list: async () => { throw new Error('not supported'); } });
    await expect(unavailable('c1', { readAt: 200 })).resolves.toBeUndefined();
  });
});
