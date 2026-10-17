import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { MessageInfo as MessageInfoData, ReceiptStatus } from '../src/lib/conversations';
import { receiptCounts, RECEIPT_FIELDS } from '../../../functions/src/chats/receiptCounts';

const state = vi.hoisted(() => ({ getMessageInfo: vi.fn() }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', TextInput: 'TextInput',
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: null }, db: {} }));
vi.mock('../src/lib/conversations', () => ({ getMessageInfo: state.getMessageInfo }));
vi.mock('../src/lib/userProfiles', () => ({
  useDisplayNames: () => (uid: string) => `Recipient ${uid}`,
}));
vi.mock('../src/components/state', () => ({
  LoadingState: 'LoadingState', ErrorState: 'ErrorState', PermissionState: 'PermissionState',
}));
import MessageInfo from '../src/screens/MessageInfo';

let renderer: ReactTestRenderer;
const nodes = (type: string) => renderer.root.findAll(node => String(node.type) === type);
const hasText = (text: string) => nodes('Text').some(node => node.props.children === text);
const stats = () => Object.fromEntries(['Delivered', 'Read', 'Pending', 'Failed'].map(label => {
  const labelNode = nodes('Text').find(node => node.props.children === label)!;
  const value = labelNode.parent!.findAll(node => String(node.type) === 'Text')
    .find(node => typeof node.props.children === 'number')!.props.children;
  return [label, value];
}));

function infoFor(statuses: ReceiptStatus[], isSender = true): MessageInfoData {
  // Exercise the actual server aggregate contract: read also contributes to viewed.
  const aggregates = receiptCounts(null);
  for (const status of statuses) {
    const contribution = receiptCounts(status);
    for (const field of RECEIPT_FIELDS) aggregates[field] += contribution[field];
  }
  return {
    messageId: 'm', conversationId: 'c', type: 'text', senderUid: 'sender', senderDisplayName: null,
    createdAt: null, editedAt: null, deletedForEveryone: false, deletedAt: null, pinnedAt: null,
    pinnedBy: null, forwarded: false, forwardedFrom: null, replyTo: null, reactions: {},
    isSender, isGroup: true, aggregates, receiptCounts: aggregates,
    recipients: isSender ? statuses.map((status, index) => ({
      uid: String(index), displayName: null, photoURL: null, role: 'member', status,
      deliveredAt: null, readAt: null, viewedAt: null, playedAt: null, failedAt: null, failureReason: null,
    })) : null,
  };
}

async function mount(data: MessageInfoData) {
  state.getMessageInfo.mockResolvedValue(data);
  const navigation = { goBack: vi.fn(), navigate: vi.fn() };
  await act(async () => {
    renderer = create(createElement(MessageInfo, {
      route: { params: { id: 'c', messageId: 'm', messageText: 'Hello' } }, navigation,
    }));
  });
  return navigation;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.getMessageInfo.mockReset();
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('Message Info reader count', () => {
  it('shows 7 readers, not 14, with the reported 7 delivered / 96 pending receipts', async () => {
    const data = infoFor([...Array<ReceiptStatus>(7).fill('read'), ...Array<ReceiptStatus>(96).fill('pending')]);
    expect(data.aggregates).toMatchObject({ readCount: 7, viewedCount: 7 });
    await mount(data);
    expect(stats()).toEqual({ Delivered: 7, Read: 7, Pending: 96, Failed: 0 });
    expect(hasText('Read 7')).toBe(true);
    const readTab = nodes('Text').find(node => node.props.children === 'Read 7')!.parent!;
    await act(async () => readTab.props.onPress());
    expect(nodes('Text').filter(node => /^Recipient /.test(String(node.props.children)))).toHaveLength(7);
  });

  it.each([
    ['text read', ['read', 'read'], 2],
    ['media viewed', ['viewed', 'viewed'], 2],
    ['media played', ['played', 'played'], 2],
    ['mixed read/viewed/played', ['read', 'viewed', 'played'], 3],
  ] as const)('counts each %s receipt once and leaves other statistics unchanged', async (_label, readStatuses, expected) => {
    await mount(infoFor([...readStatuses, 'delivered', 'pending', 'failed']));
    expect(stats()).toEqual({ Delivered: expected + 1, Read: expected, Pending: 1, Failed: 1 });
    expect(hasText(`Read ${expected}`)).toBe(true);
  });

  it('also counts once for non-senders who receive aggregates without recipient details', async () => {
    await mount(infoFor(['read', 'viewed', 'played', 'delivered'], false));
    expect(stats()).toEqual({ Delivered: 4, Read: 3, Pending: 0, Failed: 0 });
    expect(nodes('PermissionState')).toHaveLength(1);
  });

  it('shows zero readers before any receipt is read, viewed or played', async () => {
    await mount(infoFor(['delivered', 'pending', 'failed']));
    expect(stats()).toEqual({ Delivered: 1, Read: 0, Pending: 1, Failed: 1 });
  });

  it('keeps the OfflineSMS action available when one of two delivered recipients has not read', async () => {
    const navigation = await mount(infoFor(['read', 'delivered']));
    expect(stats().Read).toBe(1);
    const action = nodes('Text').find(node => node.props.children === 'Send via OfflineSMS')!.parent!;
    await act(async () => action.props.onPress());
    expect(navigation.navigate).toHaveBeenCalledWith('SmsEscalation', {
      conversationId: 'c', messageId: 'm', messageText: 'Hello',
    });
  });

  it('hides the OfflineSMS action when every recipient has read, viewed or played', async () => {
    await mount(infoFor(['read', 'viewed', 'played']));
    expect(stats().Read).toBe(3);
    expect(hasText('Send via OfflineSMS')).toBe(false);
  });
});
