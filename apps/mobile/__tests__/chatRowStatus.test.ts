import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', Image: 'Image', StyleSheet: { create: (x: any) => x } }));
vi.mock('../src/i18n', () => ({ isRTL: false }));
import { ChatRow } from '../src/screens/ChatRow';
const colors = { action: { primary: '#16779d', primaryFg: '#fff' }, text: { primary: '#132c3c', muted: '#607785', link: '#16779d' }, background: { app: '#fff' } };
let tree: ReactTestRenderer | undefined;
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = undefined; vi.unstubAllGlobals(); });

describe('chat avatar status entry', () => {
  it('opens the story from the avatar and the conversation from its separate message row', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const onOpen = vi.fn(), onOpenStatus = vi.fn();
    const props: any = { item: { id: 'c', type: 'direct', peerName: 'Peer', photoURL: 'https://example.test/avatar.jpg', someoneTyping: false },
      onOpen, onOpenStatus, onLongPress: vi.fn(), typingLabel: 'Typing', recordingLabel: 'Recording', formatTime: () => '', colors,
      statusRing: 'unseen', statusLabel: 'View status' };
    await act(async () => { tree = create(createElement(ChatRow, props)); });
    const buttons = tree!.root.findAllByType('Pressable' as any);
    expect(buttons[0].props.accessibilityLabel).toBe('View status: Peer');
    await act(async () => buttons[0].props.onPress());
    expect(onOpenStatus).toHaveBeenCalledWith('c'); expect(onOpen).not.toHaveBeenCalled();
    await act(async () => buttons[1].props.onPress()); expect(onOpen).toHaveBeenCalledWith('c');
    await act(async () => tree!.update(createElement(ChatRow, { ...props, statusRing: undefined })));
    expect(tree!.root.findAllByType('Pressable' as any)[0].props.accessibilityLabel).toBe('Peer');
  });
});
