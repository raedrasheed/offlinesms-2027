import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const native = vi.hoisted(() => ({ state: 'active', callbacks: new Set<(state: string) => void>() }));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return native.state; },
  addEventListener: (_type: string, callback: (state: string) => void) => {
    native.callbacks.add(callback); return { remove: () => native.callbacks.delete(callback) };
  },
} }));
vi.mock('../src/localdb/sync/networkState', () => ({ startNetworkWatch: () => () => {}, onConnectivityChange: () => () => {} }));
vi.mock('../src/localdb/sync/syncEngine', () => ({ syncNow: async () => {} }));
import { useConversationVisibility } from '../src/hooks/useConversationVisibility';
import { activateConversation, getActiveConversationId, stopScheduler } from '../src/localdb/sync/syncScheduler';

let renderer: ReactTestRenderer | undefined;
let visible = false;
function Screen({ id = 'chat', focused = true }: { id?: string; focused?: boolean }) {
  visible = useConversationVisibility(id, focused); return null;
}
beforeEach(() => { native.state = 'active'; native.callbacks.clear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; stopScheduler(); vi.unstubAllGlobals(); });

describe('only the foreground focused chat is read/notification-suppressed', () => {
  it('releases the active conversation on blur and background, then restores on resume', async () => {
    await act(async () => { renderer = create(createElement(Screen)); });
    expect(visible).toBe(true); expect(getActiveConversationId()).toBe('chat');
    await act(async () => renderer!.update(createElement(Screen, { focused: false })));
    expect(visible).toBe(false); expect(getActiveConversationId()).toBeUndefined();
    await act(async () => renderer!.update(createElement(Screen, { focused: true })));
    await act(async () => native.callbacks.forEach(callback => callback('background')));
    expect(visible).toBe(false); expect(getActiveConversationId()).toBeUndefined();
    await act(async () => native.callbacks.forEach(callback => callback('active')));
    expect(visible).toBe(true); expect(getActiveConversationId()).toBe('chat');
  });

  it('stale stack cleanup cannot release a newer screen, even for the same chat id', () => {
    const stopOld = activateConversation('chat');
    const stopNew = activateConversation('chat');
    stopOld();
    expect(getActiveConversationId()).toBe('chat');
    stopNew();
    expect(getActiveConversationId()).toBeUndefined();
  });
});
