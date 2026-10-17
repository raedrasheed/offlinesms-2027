// Mount the real form. Native host views are mocked: these tests guard the
// Android resize ownership and form state/scroll wiring, not on-device IME rendering.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

const native = vi.hoisted(() => ({ os: 'android', scrollTo: vi.fn(), dismiss: vi.fn() }));
vi.mock('react-native', () => ({
  Modal: 'Modal', View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
  ScrollView: 'ScrollView', Switch: 'Switch', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { get OS() { return native.os; } },
  Keyboard: { dismiss: native.dismiss },
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: { n?: number }) => values?.n ? `${key}:${values.n}` : key,
}) }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 20 }) }));
vi.mock('../src/i18n', () => ({ isRTL: true }));
vi.mock('../src/context/ThemeContext', () => ({ useTheme: () => ({ colors: {
  background: { surface: '#fff', app: '#fff' }, text: { primary: '#111', secondary: '#222', muted: '#666', disabled: '#999' },
  action: { primary: '#168' }, border: { subtle: '#ccc' }, state: { error: '#f00' },
} }) }));

import { CreatePollSheet } from '../src/components/chat/CreatePollSheet';

let renderer: ReactTestRenderer;
function nodes(type: string) { return renderer.root.findAll(node => String(node.type) === type); }
function style(node: ReactTestInstance) { return Object.assign({}, ...[node.props.style].flat(Infinity)); }
function layout(node: ReactTestInstance, y: number, height: number) {
  node.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 360, height } } });
}
async function mount() {
  const onCreate = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    renderer = create(createElement(CreatePollSheet, { visible: true, onCreate, onClose }), {
      createNodeMock: element => element.type === 'ScrollView' ? { scrollTo: native.scrollTo } : null,
    });
  });
  return { onCreate, onClose };
}

beforeEach(() => {
  native.os = 'android';
  vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.unstubAllGlobals();
});

describe('CreatePollSheet keyboard regression', () => {
  it('closes through the Android system Back callback without submitting the poll', async () => {
    const { onCreate, onClose } = await mount();
    await act(async () => nodes('TextInput')[0].props.onChangeText('مسودة'));
    await act(async () => nodes('Modal')[0].props.onRequestClose());
    expect(onClose).toHaveBeenCalledOnce(); expect(onCreate).not.toHaveBeenCalled();
    expect(native.dismiss).toHaveBeenCalledOnce();
  });
  it('lets the Android modal resize once, with a bounded flex form and a fixed header', async () => {
    await mount();
    expect(nodes('KeyboardAvoidingView')).toHaveLength(0);
    const frame = nodes('Modal')[0].children[0] as ReactTestInstance;
    expect(frame.type).toBe('View');
    expect(style(frame)).toMatchObject({ flex: 1 });
    expect(style(frame)).not.toHaveProperty('height');
    const form = nodes('ScrollView')[0];
    expect(style(form)).toMatchObject({ flex: 1, minHeight: 0 });
    expect(style(form.parent!)).toMatchObject({ flex: 1, minHeight: 0 });
    expect(form.findAll(node => node.props.accessibilityLabel === 'common.cancel')).toHaveLength(0);
    expect(nodes('Pressable').some(node => node.props.children?.props?.children === 'common.send')).toBe(true);
  });

  it('keeps iOS padding avoidance', async () => {
    native.os = 'ios';
    await mount();
    expect(nodes('KeyboardAvoidingView')).toHaveLength(1);
    expect(nodes('KeyboardAvoidingView')[0].props.behavior).toBe('padding');
  });

  it.each(['android', 'ios'])('reveals the last option once after repeated %s keyboard layouts', async os => {
    native.os = os;
    await mount();
    for (let i = 0; i < 12; i++) {
      await act(async () => nodes('TextInput')[i + 1].props.onChangeText(`الخيار ${i + 1}`));
    }
    const form = nodes('ScrollView')[0];
    const last = nodes('TextInput')[12];
    await act(async () => {
      layout(form, 0, 600);
      layout(last.parent!, 1050, 48);
      last.props.onFocus();
    });
    native.scrollTo.mockClear();
    await act(async () => {
      for (let i = 0; i < 20; i++) layout(form, 0, 240);
    });
    expect(native.scrollTo.mock.calls).toEqual([[{ y: 870, animated: false }]]);
    expect(last.props.value).toBe('الخيار 12');
    expect(style(form)).not.toHaveProperty('height');
  });

  it('keeps the Arabic draft and sends it after repeated keyboard open/close layouts', async () => {
    const { onCreate } = await mount();
    await act(async () => nodes('TextInput')[0].props.onChangeText('هل يناسبك الموعد؟'));
    await act(async () => nodes('TextInput')[1].props.onChangeText('نعم'));
    await act(async () => nodes('TextInput')[2].props.onChangeText('لا'));
    await act(async () => nodes('Switch')[0].props.onValueChange(true));
    const form = nodes('ScrollView')[0];
    const question = nodes('TextInput')[0];
    await act(async () => {
      layout(question, 30, 80);
      question.props.onFocus();
      for (const height of [600, 260, 260, 600, 600, 240, 240, 600]) layout(form, 0, height);
    });
    expect(nodes('TextInput')[0].props.value).toBe('هل يناسبك الموعد؟');
    expect(native.scrollTo).not.toHaveBeenCalled();
    const send = nodes('Pressable').find(node => node.props.children?.props?.children === 'common.send')!;
    await act(async () => send.props.onPress());
    expect(onCreate).toHaveBeenCalledOnce();
    expect(onCreate).toHaveBeenCalledWith({ question: 'هل يناسبك الموعد؟', options: ['نعم', 'لا'], multiple: true });
    expect(native.dismiss).toHaveBeenCalledOnce();
  });
});
