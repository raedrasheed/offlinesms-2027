import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer';
import type { ClipItem, ClipComment } from '../src/lib/clips';
const api = vi.hoisted(() => ({ list: vi.fn(), add: vi.fn(), like: vi.fn(), remove: vi.fn(), share: vi.fn(), report: vi.fn(), alert: vi.fn(), copy: vi.fn() }));
vi.mock('react-native', () => ({ Modal: 'Modal', View: 'View', Text: 'Text', Pressable: 'Pressable', TextInput: 'TextInput', ScrollView: 'ScrollView', Image: 'Image', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView', Platform: { OS: 'android' }, StyleSheet: { create: (s: unknown) => s, hairlineWidth: 1 }, Alert: { alert: api.alert }, Clipboard: { setString: api.copy }, Share: { share: vi.fn() } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('../src/lib/firebase', () => ({ auth: { currentUser: { uid: 'me' } } }));
vi.mock('../src/lib/clipsCopy', () => ({ useClipsCopy: () => ({ c: (en: string) => en, rtl: false }) }));
vi.mock('../src/lib/clips', () => ({ listClipComments: api.list, addClipComment: api.add, setClipCommentLike: api.like, deleteClipComment: api.remove, shareClip: api.share, reportClip: api.report, clipLink: (id: string) => `https://offlinesms.com/clips/${id}` }));
vi.mock('../src/hooks/useClipDestinations', () => ({ useClipDestinations: () => ({ rows: [{ id: 'chatA', label: 'A', type: 'direct' }, { id: 'chatB', label: 'B', type: 'group' }], loading: false }) }));
import ClipCommentsSheet from '../src/components/clips/ClipCommentsSheet';
import ClipShareSheet from '../src/components/clips/ClipShareSheet';
import { trimDraftRange, appendUnique } from '../src/lib/clipSocialModel';
import { ClipTermsFlowError } from '../src/lib/clipTerms';

const clip = { id: 'clip1', ownerUid: 'creator', commentCount: 1, allowComments: true, audience: 'public', author: { uid: 'creator', displayName: 'Creator', username: 'creator', photoURL: null } } as ClipItem;
const comment: ClipComment = { id: 'comment1', authorUid: 'me', author: { uid: 'me', displayName: 'Me', username: 'me', photoURL: null }, text: 'Hello', parentId: null, createdAtMs: 1, likeCount: 0, likedByMe: false, replyCount: 1, deleted: false, canDelete: true };
let renderer: ReactTestRenderer;
const nodes = (type: string) => renderer.root.findAll(node => node.type === type);
const label = (value: string) => nodes('Pressable').find(node => node.props.accessibilityLabel === value)!;
const textIn = (node: ReactTestInstance, value: string) => node.findAll(item => String(item.type) === 'Text' && item.children.some(child => typeof child === 'string' && child.startsWith(value))).length > 0;
const button = (value: string) => nodes('Pressable').find(node => textIn(node, value))!;
async function tap(node: ReactTestInstance) { await act(async () => { await node.props.onPress(); }); }
async function mountComments(input: ClipItem = clip) { await act(async () => { renderer = create(createElement(ClipCommentsSheet, { visible: true, clip: input, onClose: vi.fn() })); }); }
async function mountShare(input: ClipItem = clip) { await act(async () => { renderer = create(createElement(ClipShareSheet, { visible: true, clip: input, onClose: vi.fn() })); }); }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); api.list.mockResolvedValue({ items: [comment], nextCursor: null }); api.add.mockResolvedValue({ commentId: 'new' }); api.like.mockResolvedValue({ likeCount: 1 }); api.share.mockResolvedValue({ messageId: 'message' }); });
afterEach(async () => { if (renderer) await act(async () => { renderer.unmount(); }); vi.unstubAllGlobals(); });

describe('Clip comments', () => {
  it('reuses the operation id after an unconfirmed send', async () => {
    api.add.mockRejectedValueOnce(new Error('response-lost'));
    await mountComments();
    await act(async () => { nodes('TextInput')[0].props.onChangeText('A new comment'); });
    await tap(label('Send comment'));
    expect(nodes('TextInput')[0].props.value).toBe('A new comment');
    await tap(label('Send comment'));
    expect(api.add).toHaveBeenCalledTimes(2);
    expect(api.add.mock.calls[0][0]).toEqual(api.add.mock.calls[1][0]);
    expect(nodes('TextInput')[0].props.value).toBe('');
  });
  it('routes a nested reply to the root and updates comment likes', async () => {
    const child = { ...comment, id: 'child', parentId: 'comment1', text: 'Reply', replyCount: 0 };
    api.list.mockImplementation(({ parentId }: { parentId?: string }) => Promise.resolve({ items: parentId ? [child] : [comment], nextCursor: null }));
    await mountComments(); await tap(button('View 1 replies'));
    expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ parentId: 'comment1' }));
    await tap(nodes('Pressable').filter(node => textIn(node, 'Reply')).at(-1)!);
    await act(async () => { nodes('TextInput')[0].props.onChangeText('Nested reply'); });
    await tap(label('Send comment'));
    expect(api.add).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'comment1', text: 'Nested reply' }));
    await tap(label('Like comment'));
    expect(api.like).toHaveBeenCalledWith('clip1', 'comment1', true);
  });
  it('does not show a composer when comments are disabled', async () => { await mountComments({ ...clip, allowComments: false }); expect(nodes('TextInput')).toHaveLength(0); expect(button('Reply')).toBeUndefined(); });
  it('ignores a response for a clip that was replaced', async () => {
    let resolve!: (value: unknown) => void;
    api.list.mockReturnValueOnce(new Promise(done => { resolve = done; }));
    await mountComments();
    await act(async () => { renderer.update(createElement(ClipCommentsSheet, { visible: true, clip: { ...clip, id: 'clip2' }, onClose: vi.fn() })); });
    await act(async () => { resolve({ items: [{ ...comment, text: 'STALE' }], nextCursor: null }); });
    expect(nodes('Text').some(node => node.children.includes('STALE'))).toBe(false);
  });
});
describe('Clip sharing', () => {
  it('stops a cancelled terms flow without trying another recipient or showing an error', async () => {
    api.share.mockRejectedValueOnce(new ClipTermsFlowError('clips-terms-cancelled'));
    await mountShare();
    for (const node of nodes('Pressable').filter(node => node.props.accessibilityRole === 'checkbox')) await tap(node);
    await tap(button('Send'));
    expect(api.share).toHaveBeenCalledOnce();
    expect(nodes('Pressable').filter(node => node.props.accessibilityRole === 'checkbox' && node.props.accessibilityState.checked)).toHaveLength(2);
    expect(nodes('Text').some(node => node.children.some(value => typeof value === 'string' && value.startsWith('Some shares')))).toBe(false);
  });
  it('retries only failed recipients with their original idempotency id', async () => {
    api.share.mockResolvedValueOnce({ messageId: 'one' }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ messageId: 'two' });
    await mountShare();
    for (const node of nodes('Pressable').filter(node => node.props.accessibilityRole === 'checkbox')) await tap(node);
    await tap(button('Send')); await tap(button('Send'));
    expect(api.share.mock.calls.map(call => call[0].conversationId)).toEqual(['chatA', 'chatB', 'chatB']);
    expect(api.share.mock.calls[1][0].clientId).toBe(api.share.mock.calls[2][0].clientId);
  });
  it.each([{ ...clip, audience: 'followers' as const }, { ...clip, author: { ...clip.author, privateAccount: true } }])('offers no external share for restricted clips', async input => { await mountShare(input); expect(button('Copy link')).toBeUndefined(); expect(button('Share externally')).toBeUndefined(); });
  it('copies only the app reference, never a playback URL', async () => { await mountShare(); await tap(button('Copy link')); expect(api.copy).toHaveBeenCalledWith('https://offlinesms.com/clips/clip1'); });
});
describe('Draft edit bounds', () => {
  it('rejects out-of-source and too-long segments', () => { expect(trimDraftRange(90_000, '20', '90', 60)).toBeNull(); expect(trimDraftRange(30_000, '0', '31', 60)).toBeNull(); expect(trimDraftRange(30_000, '10', '10', 60)).toBeNull(); expect(trimDraftRange(90_000, '30.25', '89.25', 60)).toEqual({ trimStartMs: 30250, trimEndMs: 89250 }); });
  it('merges pages without losing an edited comment or duplicating a page row', () => { expect(appendUnique([{ id: 'a', text: 'new' }], [{ id: 'a', text: 'stale' }, { id: 'b', text: 'B' }, { id: 'b', text: 'B' }])).toEqual([{ id: 'a', text: 'new' }, { id: 'b', text: 'B' }]); });
  it('accepts Arabic and Persian digits from localized numeric keyboards', () => { expect(trimDraftRange(30_000, '١٫٥', '۲۹', 60)).toEqual({ trimStartMs: 1500, trimEndMs: 29000 }); });
  it('rejects ranges that collapse after millisecond rounding or clamping', () => { expect(trimDraftRange(30_000, '30.1', '30.2', 60)).toBeNull(); expect(trimDraftRange(30_000, '29.9996', '30', 60)).toBeNull(); expect(trimDraftRange(0, '0', '0.1', 60)).toBeNull(); });
});
