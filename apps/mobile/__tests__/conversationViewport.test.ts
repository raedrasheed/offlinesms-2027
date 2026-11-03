import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useConversationViewport } from '../src/hooks/useConversationViewport';

type Options = Parameters<typeof useConversationViewport>[0];
let renderer: ReactTestRenderer | undefined;
let latest: ReturnType<typeof useConversationViewport>;
let options: Options;
const scrollToOffset = vi.fn();
const scrollToIndex = vi.fn();
const consumeFocus = vi.fn();
function Screen(props: Options) { latest = useConversationViewport(props); return null; }
async function render(patch: Partial<Options> = {}) {
  options = { ...options, ...patch };
  await act(async () => {
    if (renderer) renderer.update(createElement(Screen, options));
    else renderer = create(createElement(Screen, options));
  });
  await act(async () => { vi.advanceTimersByTime(20); });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.clearAllMocks();
  options = { conversationId: 'c', uid: 'me', active: true, focused: true, rows: [{ id: 'cached', senderUid: 'peer' }],
    list: { current: { scrollToOffset, scrollToIndex } }, consumeFocus };
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('conversation entry and notification viewport', () => {
  it('opens at latest cached row and follows the newly fetched row without resetting history', async () => {
    await render();
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
    await render({ rows: [{ id: 'push', senderUid: 'peer' }, ...options.rows] });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: true });
  });

  it('waits for a cold-start target, scrolls to it once, and consumes it only when actually visible', async () => {
    await render({ focusMessageId: 'target' });
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(consumeFocus).not.toHaveBeenCalled();
    await render({ rows: [{ id: 'newer' }, { id: 'target' }, { id: 'older' }] });
    expect(scrollToIndex).toHaveBeenCalledWith({ index: 1, animated: false, viewPosition: 0.5 });
    await act(async () => latest.onVisible(['newer']));
    expect(consumeFocus).not.toHaveBeenCalled();
    await act(async () => latest.onVisible(['target']));
    expect(consumeFocus).toHaveBeenCalledWith('target');
    await render({ focusMessageId: undefined });
    await render({ active: false, focused: false });
    await render({ active: true, focused: true });
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
  });

  it('accepts another warm notification in the same mounted conversation', async () => {
    await render({ focusMessageId: 'cached' });
    await act(async () => latest.onVisible(['cached']));
    await render({ focusMessageId: undefined });
    await render({ focusMessageId: 'second', rows: [{ id: 'second' }, { id: 'cached' }] });
    expect(latest.highlightId).toBe('second');
    await act(async () => latest.onVisible(['second']));
    expect(consumeFocus.mock.calls.map(call => call[0])).toEqual(['cached', 'second']);
  });

  it('preserves intentional history browsing during pagination and incoming messages', async () => {
    await render();
    await act(async () => latest.onScroll({ nativeEvent: { contentOffset: { y: 350 } } }));
    scrollToOffset.mockClear();
    await render({ rows: [...options.rows, { id: 'older' }] });
    expect(scrollToOffset).not.toHaveBeenCalled();
    await render({ rows: [{ id: 'incoming', senderUid: 'peer' }, ...options.rows] });
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(latest.showScrollDown).toBe(true);
    await act(async () => latest.scrollToBottom());
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
    expect(latest.showScrollDown).toBe(false);
  });

  it('does not scroll or consume a target behind another screen', async () => {
    await render({ active: false, focused: false, focusMessageId: 'cached' });
    await act(async () => latest.onVisible(['cached']));
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(consumeFocus).not.toHaveBeenCalled();
    await render({ active: true, focused: true });
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
  });

  it('preserves history position across app backgrounding while still following a new notification target', async () => {
    await render();
    await act(async () => latest.onScroll({ nativeEvent: { contentOffset: { y: 350 } } }));
    scrollToOffset.mockClear();
    await render({ active: false });
    await render({ active: true, rows: [{ id: 'incoming', senderUid: 'peer' }, ...options.rows] });
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(latest.showScrollDown).toBe(true);
    await render({ focusMessageId: 'incoming' });
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });

  it('does not lose the latest scroll when a receipt update arrives before the next frame', async () => {
    await render();
    scrollToOffset.mockClear();
    options = { ...options, rows: [{ id: 'new', senderUid: 'peer' }, ...options.rows] };
    await act(async () => renderer!.update(createElement(Screen, options)));
    options = { ...options, rows: options.rows.map(row => ({ ...row })) };
    await act(async () => renderer!.update(createElement(Screen, options)));
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: true });
  });
});
