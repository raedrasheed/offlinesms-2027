import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const memory = vi.hoisted(() => new Map<string, string>());
const storage = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: storage }));
import { useChatVisibility } from '../src/hooks/useChatVisibility';
let value: ReturnType<typeof useChatVisibility>;
let tree: ReactTestRenderer | undefined;
function Harness({ uid }: { uid: string }) { value = useChatVisibility(uid); return null; }
const row = { type: 'direct', lastMessageId: 'm1', lastMessageAt: 100, lastMessageText: 'hello' };
async function mount(uid = 'me') { await act(async () => { tree = create(createElement(Harness, { uid })); }); }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); memory.clear();
  storage.getItem.mockReset().mockImplementation(async key => memory.get(key) ?? null);
  storage.setItem.mockReset().mockImplementation(async (key, text) => { memory.set(key, text); });
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.unstubAllGlobals(); });

describe('account-scoped chat deletion persistence', () => {
  it('survives app relaunch and does not affect a different account', async () => {
    await mount();
    await act(async () => { await value.hide('c', row); });
    await act(async () => tree!.unmount()); tree = undefined;
    await mount(); expect(value.hidden.c).toEqual({ messageId: 'm1', messageAt: 100 });
    await act(async () => tree!.update(createElement(Harness, { uid: 'other' })));
    expect(value.hidden).toEqual({});
  });
  it('serializes rapid deletions instead of overwriting the earlier one', async () => {
    await mount();
    await act(async () => { await Promise.all([value.hide('c1', row), value.hide('c2', row)]); });
    expect(Object.keys(JSON.parse(memory.get('chats.hidden.v1:me')!)).sort()).toEqual(['c1', 'c2']);
  });
  it('does not report success or hide a row when the persisted write failed', async () => {
    await mount(); storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    await act(async () => { await expect(value.hide('c', row)).rejects.toThrow('disk full'); });
    expect(value.hidden).toEqual({});
  });
  it('ignores a stale read after switching accounts', async () => {
    let finish: (v: string) => void = () => {};
    storage.getItem.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await mount(); expect(value.loaded).toBe(false);
    await act(async () => tree!.update(createElement(Harness, { uid: 'other' })));
    await act(async () => { finish(JSON.stringify({ c: { messageId: 'm1', messageAt: 100 } })); });
    expect(value.hidden).toEqual({}); expect(value.loaded).toBe(true);
  });
});
