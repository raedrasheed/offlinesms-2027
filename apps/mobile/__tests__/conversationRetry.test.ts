import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), start: vi.fn(), open: vi.fn(),
  request: vi.fn(), retry: vi.fn(), position: vi.fn(),
}));
vi.mock('../src/config/features', () => ({ LOCAL_FIRST_CONVERSATION_ENABLED: true }));
vi.mock('../src/localdb', () => ({
  openLocalDb: mocks.open, initLocalDb: async () => {},
  messagesRepo: { listMessages: mocks.list, positionFromNewest: mocks.position },
  setActiveConversation: () => {}, clearChat: async () => 0, getChatClearedAt: async () => 0,
  notificationTargets: { request: mocks.request, retry: mocks.retry, subscribe: () => () => {} },
}));
vi.mock('../src/localdb/sync/conversationFeeder', () => ({ startConversationFeeder: mocks.start }));
vi.mock('../src/localdb/sync/firebasePull', () => ({ pullMessageHistoryPage: async () => 0 }));
vi.mock('../src/localdb/sync/networkState', () => ({ isOnline: () => true, onConnectivityChange: () => () => {} }));
vi.mock('../src/localdb/sync/legacyImport', () => ({ importLegacyQueueOnce: async () => {} }));

import { useLocalConversation, type LocalConversation } from '../src/hooks/useLocalConversation';

let renderer: ReactTestRenderer;
let latest: LocalConversation;
function Screen({ focus }: { focus?: string }) {
  latest = useLocalConversation('c', 'u', focus);
  return null;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.open.mockResolvedValue(undefined);
  mocks.list.mockResolvedValue([{ id: 'saved', remote_id: 'saved', conversation_id: 'c',
    sender_uid: 'peer', type: 'text', text: 'saved message', remote_created_at: 1,
    created_at: 1, status: 'sent' }]);
  mocks.position.mockResolvedValue(null);
  mocks.start.mockImplementation(() => vi.fn());
  mocks.retry.mockResolvedValue('error');
  mocks.request.mockResolvedValue('error');
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });

describe('conversation retry', () => {
  it('restarts a failed feed without a notification target and preserves saved messages', async () => {
    await act(async () => { renderer = create(createElement(Screen)); });
    const stop = mocks.start.mock.results[0].value;
    await act(async () => { mocks.start.mock.calls[0][2]('local-write-failed'); });
    expect(latest.live).toBe('error');
    expect(latest.messages.map(m => m.id)).toEqual(['saved']);
    await act(async () => { latest.retrySync(); });
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(latest.loading).toBe(false);
    expect(latest.messages.map(m => m.id)).toEqual(['saved']);
    expect(mocks.retry).not.toHaveBeenCalled();
    await act(async () => { mocks.start.mock.calls[1][1]({ ids: [], fromCache: false }); });
    expect(latest.live).toBe('live');
  });

  it('retries the notification target as well as the listener', async () => {
    await act(async () => { renderer = create(createElement(Screen, { focus: 'push' })); });
    await act(async () => { latest.retrySync(); });
    expect(mocks.start).toHaveBeenCalledTimes(2);
    expect(mocks.retry).toHaveBeenCalledWith('c', 'push');
    expect(latest.messages.map(m => m.id)).toEqual(['saved']);
  });
});
