import { describe, expect, it, vi } from 'vitest';
import { createPushTapQueue } from '../src/lib/pushTapQueue';

describe('notification tap acknowledgement', () => {
  it('keeps a cold-start tap until auth and navigation accept it', () => {
    let ready = false;
    const consumed = vi.fn(), received = vi.fn(), opened = vi.fn();
    const queue = createPushTapQueue({ dispatch: data => {
      if (!ready) return false; opened(data); return true;
    }, consumed, received });
    queue.receive('notice-a', { conversationId: 'a' });
    expect(consumed).not.toHaveBeenCalled();
    queue.receive('notice-a', { conversationId: 'a' });
    expect(received).toHaveBeenCalledTimes(1);
    ready = true; queue.drain(); queue.drain();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(consumed).toHaveBeenCalledTimes(1); expect(consumed).toHaveBeenCalledWith('notice-a');
    expect(queue.hasPending()).toBe(false);
  });
  it('opens the latest tap if another arrives during sign-in', () => {
    let ready = false;
    const consumed = vi.fn(), opened = vi.fn();
    const queue = createPushTapQueue({ dispatch: data => {
      if (!ready) return false; opened(data); return true;
    }, consumed, received: vi.fn() });
    queue.receive('old', 'old-chat'); queue.receive('new', 'new-chat');
    ready = true; queue.drain();
    expect(opened).toHaveBeenCalledTimes(1); expect(opened).toHaveBeenCalledWith('new-chat');
    expect(consumed).toHaveBeenCalledTimes(1); expect(consumed).toHaveBeenCalledWith('new');
  });
  it('allows a later notice for the same conversation', () => {
    const dispatch = vi.fn(() => true), consumed = vi.fn();
    const queue = createPushTapQueue({ dispatch, consumed, received: vi.fn() });
    queue.receive('first', { conversationId: 'a', messageId: 'one' });
    queue.receive('second', { conversationId: 'a', messageId: 'two' });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(consumed).toHaveBeenLastCalledWith('second');
  });
});
