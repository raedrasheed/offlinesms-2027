import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const state = vi.hoisted(() => ({
  own: { known: true, selection: ['o2'], seq: 17, pending: false, failed: false },
  profiles: vi.fn(), rtl: true,
}));
vi.mock('react-native', async () => {
  const { createElement: h } = await import('react');
  return { Modal: 'Modal', View: 'View', Text: 'Text', Pressable: 'Pressable',
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 },
    FlatList: (p: any) => h('FlatList', {}, p.ListHeaderComponent,
      ...p.data.map((item: any) => h('Row', { key: item.uid }, p.renderItem({ item }))), p.data.length ? null : p.ListEmptyComponent),
  };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: { count?: number }) => args?.count != null ? `${key}:${args.count}` : key }) }));
vi.mock('../src/i18n', () => ({ get isRTL() { return state.rtl; } }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 20 }) }));
vi.mock('../src/context/ThemeContext', () => ({ useTheme: () => ({ colors: {
  background: { surface: '#fff', app: '#eee' }, text: { primary: '#111', secondary: '#333', muted: '#666' },
  action: { primary: '#168' }, border: { subtle: '#ccc' },
} }) }));
vi.mock('../src/hooks/useOwnPollVote', () => ({ useOwnPollVote: () => state.own }));
vi.mock('../src/lib/userProfiles', () => ({ useDisplayNames: (uids: string[]) => {
  state.profiles(uids); return (uid: string) => ({ alice: 'أحمد', bob: 'سارة' }[uid] ?? 'Unknown user');
} }));
import { PollBubble } from '../src/components/chat/PollBubble';
import { sanitizePoll } from '../src/lib/pollModel';
let renderer: ReactTestRenderer;
const nodes = (type: string) => renderer.root.findAll(node => String(node.type) === type);
const json = () => JSON.stringify(renderer.toJSON());
async function mount(anonymous: boolean, closed = false) {
  const onVote = vi.fn(), onClose = vi.fn();
  const poll = sanitizePoll({ question: 'متى نلتقي؟', anonymous, closed, multiple: true,
    options: [{ id: 'o1', text: 'اليوم' }, { id: 'o2', text: 'غداً' }],
    votes: { alice: ['o1', 'o2'], bob: ['o2'] }, counts: { o1: 1, o2: 2 }, voterCount: 2 });
  await act(async () => { renderer = create(createElement(PollBubble, { poll, me: 'alice', isCreator: true, mine: false,
    conversationId: 'chat', messageId: 'poll', onVote, onClose })); });
  return { onVote, onClose };
}
async function openResults() {
  const button = nodes('Pressable').find(node => String(node.props.children?.props?.children).match(/^poll\.(viewVoters|results)$/))!;
  await act(async () => button.props.onPress());
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); state.profiles.mockClear(); state.rtl = true;
  state.own = { known: true, selection: ['o2'], seq: 17, pending: false, failed: false }; });
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.unstubAllGlobals(); });

describe('poll voter and result presentation', () => {
  it.each([true, false])('shows names + every choice for public polls, RTL=%s', async rtl => {
    state.rtl = rtl; await mount(false); await openResults();
    expect(state.profiles).toHaveBeenCalledWith(['alice', 'bob']);
    expect(json()).toContain('أحمد'); expect(json()).toContain('سارة'); expect(json()).toContain('اليوم • غداً');
    expect(json()).not.toContain('"alice"');
    await act(async () => nodes('Modal')[0].props.onRequestClose());
    expect(nodes('Modal')).toHaveLength(0);
  });
  it('shows anonymous totals and own choice without requesting any profiles', async () => {
    const { onVote } = await mount(true);
    const options = nodes('Pressable').filter(n => n.props.accessibilityRole === 'checkbox');
    expect(options.map(n => n.props.accessibilityState.checked)).toEqual([false, true]);
    await act(async () => options[0].props.onPress());
    expect(onVote).toHaveBeenCalledWith(['o1', 'o2'], 17);
    await openResults();
    expect(state.profiles).toHaveBeenCalledWith([]);
    expect(json()).toContain('poll.identitiesHidden'); expect(json()).toContain('poll.voters:2');
    expect(json()).not.toContain('أحمد'); expect(json()).not.toContain('سارة');
  });
  it('does not allow unknown private selections to erase a previous vote', async () => {
    state.own.known = false; await mount(true);
    expect(nodes('Pressable').filter(n => n.props.accessibilityRole === 'checkbox').every(n => n.props.disabled)).toBe(true);
    expect(json()).toContain('poll.loadOwnVote');
    await openResults(); expect(nodes('Modal')).toHaveLength(1);
  });
  it('keeps results available after closing, without allowing further votes', async () => {
    await mount(false, true); await openResults();
    expect(json()).toContain('أحمد');
    expect(nodes('Pressable').filter(n => n.props.accessibilityRole === 'checkbox').every(n => n.props.disabled)).toBe(true);
  });
  it.each(['pending', 'failed'] as const)('explains %s votes', async status => {
    state.own[status] = true; await mount(true);
    expect(json()).toContain(status === 'pending' ? 'poll.votePending' : 'poll.voteFailed');
  });
});
