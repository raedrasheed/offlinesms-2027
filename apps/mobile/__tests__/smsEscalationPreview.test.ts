import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

const mock = vi.hoisted(() => ({ preview: vi.fn(), send: vi.fn(), retry: vi.fn() }));
vi.mock('react-native', () => ({
  View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView',
  KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' },
  Alert: { alert: vi.fn() }, StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('../src/lib/sms', async () => ({
  ...await import('../src/lib/sms.helpers'),
  previewSmsEscalation: mock.preview, escalateSms: mock.send, retryFailedSmsRecipients: mock.retry,
}));
vi.mock('../src/lib/userProfiles', () => ({ useDisplayName: (uid: string) => uid }));
vi.mock('../src/components/CheckmarkIcon', () => ({ CheckmarkIcon: 'Checkmark' }));
vi.mock('../src/components/state', () => ({ LoadingState: 'LoadingState', ErrorState: 'ErrorState', EmptyState: 'EmptyState' }));
import SmsEscalation from '../src/screens/SmsEscalation';

let renderer: ReactTestRenderer | undefined;
function quote(body = 'Hello', token = 'quote-1') {
  return {
    audience: 'unread_only', eligibleRecipients: [{ uid: 'recipient', displayName: 'Recipient', maskedPhone: '+970***111', appReceiptStatus: null }],
    excludedRecipients: [], eligibleCount: 1, excludedCount: 0,
    pointsCost: 56, costPerSms: 28, walletBalance: 100, walletReserved: 28,
    audienceCap: 200, exceedsCap: false,
    finalSmsBody: `OfflineSMS\nالمجموعة\n+970599111111\n${body}`,
    smsSegments: 2, smsEncoding: 'UCS-2', smsUnits: 71, pointsPerRecipient: 56, quoteToken: token,
  };
}
function nodes(type: string) { return renderer!.root.findAll(node => String(node.type) === type); }
function button(text: string) {
  return nodes('Pressable').find(node => node.findAll(child => String(child.type) === 'Text').some(child => child.children.join('') === text))!;
}
async function press(text: string) { await act(async () => button(text).props.onPress()); }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(250); }); }
async function mount(body = 'Hello') {
  await act(async () => {
    renderer = create(createElement(SmsEscalation, {
      route: { params: { conversationId: 'group', messageId: 'message', messageText: body } },
      navigation: { goBack: vi.fn(), navigate: vi.fn(), popToTop: vi.fn() },
    }));
  });
}
async function textStep(body?: string) { await mount(body); await tick(); await press('Continue'); await press('Continue'); }
async function confirmStep() { await textStep(); await press('Continue'); }
async function confirm() {
  await act(async () => nodes('Pressable').find(node => node.props.accessibilityLabel === 'Confirm SMS recipients and cost')!.props.onPress());
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mock.preview.mockImplementation(async args => quote(args.smsBody));
  mock.send.mockResolvedValue({ batchId: 'batch', offlineSmsBatchId: 'batch', sent: 1, failed: 0, skipped: 0, pointsCost: 56, status: 'accepted' });
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('SMS final text and priced confirmation', () => {
  it('displays the complete server-composed SMS, uses its segment cost and submits its confirmation token', async () => {
    await confirmStep();
    const finalText = nodes('Text').find(node => node.children.join('') === quote().finalSmsBody)!;
    expect(finalText).toBeDefined(); expect(finalText.props.numberOfLines).toBeUndefined();
    expect(nodes('Text').some(node => node.children.join('').includes('2 SMS segments per recipient'))).toBe(true);
    expect(button('Send SMS for 56 points').props.disabled).toBe(true);
    await confirm(); await press('Send SMS for 56 points');
    expect(mock.send).toHaveBeenCalledWith({ conversationId: 'group', messageId: 'message', audience: 'unread_only', smsBody: 'Hello', quoteToken: 'quote-1' });
  });

  it('invalidates edited text immediately, debounces typing and ignores obsolete server responses', async () => {
    await textStep();
    let resolveOld!: (value: unknown) => void;
    mock.preview.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await act(async () => nodes('TextInput')[0].props.onChangeText('First edit'));
    expect(button('Continue').props.disabled).toBe(true);
    expect(nodes('Text').some(node => node.children.join('') === quote().finalSmsBody)).toBe(false);
    await tick();
    await act(async () => nodes('TextInput')[0].props.onChangeText('Latest edit'));
    await act(async () => resolveOld(quote('First edit', 'old-quote')));
    expect(button('Continue').props.disabled).toBe(true);
    await tick();
    expect(mock.preview.mock.calls.at(-1)?.[0].smsBody).toBe('Latest edit');
    expect(button('Continue').props.disabled).toBe(false);
    expect(nodes('Text').some(node => node.children.join('') === quote('Latest edit').finalSmsBody)).toBe(true);
    expect(nodes('Text').some(node => node.children.join('') === quote('First edit').finalSmsBody)).toBe(false);
  });

  it('refreshes a changed server quote and requires the user to reconfirm its new cost', async () => {
    await confirmStep(); await confirm();
    mock.send.mockRejectedValueOnce({ code: 'functions/failed-precondition', message: 'sms-quote-changed' });
    mock.preview.mockResolvedValueOnce({ ...quote('Hello', 'quote-2'), pointsCost: 84, pointsPerRecipient: 84, smsSegments: 3 });
    await press('Send SMS for 56 points');
    expect(button('Send SMS').props.disabled).toBe(true);
    await tick();
    expect(button('Send SMS for 84 points').props.disabled).toBe(true);
    expect(nodes('ErrorState').some(node => /changed/.test(node.props.description))).toBe(true);
    await confirm(); await press('Send SMS for 84 points');
    expect(mock.send.mock.calls.at(-1)?.[0].quoteToken).toBe('quote-2');
  });

  it('does not reuse consent after going back to edit the message', async () => {
    await confirmStep(); await confirm(); await press('Back');
    await act(async () => nodes('TextInput')[0].props.onChangeText('Changed'));
    await tick(); await press('Continue');
    expect(button('Send SMS for 56 points').props.disabled).toBe(true);
  });

  it('lets a message without initial text reach the editor but requires nonempty text before confirmation', async () => {
    await textStep('');
    expect(mock.preview).toHaveBeenCalledWith(expect.objectContaining({ smsBody: '' }));
    expect(button('Continue').props.disabled).toBe(true);
    await act(async () => nodes('TextInput')[0].props.onChangeText('New text'));
    await tick(); expect(button('Continue').props.disabled).toBe(false);
  });

  it('blocks quotes from an old backend and allows an explicit retry after deployment', async () => {
    const { quoteToken, ...legacy } = quote();
    mock.preview.mockResolvedValueOnce(legacy);
    await mount(); await tick();
    expect(button('Continue').props.disabled).toBe(true);
    expect(nodes('ErrorState')[0].props.description).toMatch(/needs an update/);
    await press('Retry preview'); await tick();
    expect(button('Continue').props.disabled).toBe(false);
  });

  it('does not allow a quote above the SMS audience cap or available balance', async () => {
    mock.preview.mockResolvedValueOnce({ ...quote(), exceedsCap: true });
    await mount(); await tick(); expect(button('Continue').props.disabled).toBe(true);
    await act(async () => renderer!.unmount()); renderer = undefined;
    mock.preview.mockResolvedValueOnce({ ...quote(), walletBalance: 40 });
    await confirmStep(); await confirm(); expect(button('Send SMS for 56 points').props.disabled).toBe(true);
  });
});
