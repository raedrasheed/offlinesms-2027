import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { PostItem } from '../src/lib/posts';
const mock = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'me' } as {uid: string} | null }, watchers: new Set<(user: {uid: string} | null) => void>(),
  list: vi.fn(), get: vi.fn(), create: vi.fn(), like: vi.fn(), remove: vi.fn(), report: vi.fn(), comments: vi.fn(), addComment: vi.fn(), deleteComment: vi.fn(),
  pick: vi.fn(), removeImage: vi.fn(), alert: vi.fn(), nav: { navigate: vi.fn(), replace: vi.fn(), goBack: vi.fn(), addListener: vi.fn(() => () => {}) },
}));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', TextInput: 'TextInput', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'android' }, StyleSheet: { create: (v: unknown) => v }, Alert: { alert: mock.alert },
  FlatList: ({ data, renderItem, ListEmptyComponent, ListFooterComponent, ...props }: any) => createElement('FlatList', props,
    data.length ? data.map((item: any) => createElement('Row', { key: item.id }, renderItem({ item }))) : ListEmptyComponent, ListFooterComponent),
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]) }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: (_auth: unknown, callback: (user: {uid: string} | null) => void) => { mock.watchers.add(callback); return () => { mock.watchers.delete(callback); }; } }));
vi.mock('../src/lib/firebase', () => ({ auth: mock.auth }));
vi.mock('../src/context/ThemeContext', () => ({ useTheme: () => ({ colors: { background: { app: '#fff', surface: '#fff', subtle: '#eee' }, border: { subtle: '#ddd', default: '#ccc', focus: '#123' }, text: { primary: '#111', muted: '#555', link: '#123' }, action: { primary: '#123', primaryFg: '#fff' }, state: { error: '#a11', errorText: '#a11' } } }) }));
vi.mock('../src/lib/clipsCopy', () => ({ useClipsCopy: () => ({ c: (en: string) => en, rtl: false }) }));
vi.mock('../src/lib/posts', () => ({ listPosts: mock.list, getPost: mock.get, createPost: mock.create, setPostLike: mock.like, deletePost: mock.remove, reportPost: mock.report, listPostComments: mock.comments, addPostComment: mock.addComment, deletePostComment: mock.deleteComment }));
vi.mock('../src/lib/postImage', () => ({ pickPostImage: mock.pick, removePostImage: mock.removeImage }));
import PostsFeed from '../src/screens/posts/PostsFeed';
import PostComposer from '../src/screens/posts/PostComposer';
import PostViewer from '../src/screens/posts/PostViewer';
import { PostCard } from '../src/components/posts/PostCard';
let renderer: ReactTestRenderer;
const post = (): PostItem => ({ id: 'post-1', ownerUid: 'other', body: 'A published post', audience: 'public', status: 'published', author: { uid: 'other', displayName: 'Creator', username: 'creator', photoURL: null }, imageUrl: null, imageExpiresAtMs: 0, createdAtMs: 1, publishedAtMs: 2, likeCount: 2, commentCount: 0, likedByMe: false, canDelete: false, moderationReason: null });
const nodes = (type: string) => renderer.root.findAllByType(type as any);
const button = (label: string) => nodes('Pressable').find(node => node.props.accessibilityLabel === label)!;
const input = (label: string) => nodes('TextInput').find(node => node.props.accessibilityLabel === label)!;
async function tap(label: string) { await act(async () => { button(label).props.onPress(); }); }
async function type(label: string, value: string) { await act(async () => { input(label).props.onChangeText(value); }); }
async function account(uid: string) { await act(async () => { mock.auth.currentUser = { uid }; for (const callback of mock.watchers) callback(mock.auth.currentUser); }); }
async function mount(component: any, params: any = {}) { await act(async () => { renderer = create(createElement(component, { navigation: mock.nav, route: { params } })); }); }
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.auth.currentUser = { uid: 'me' }; mock.watchers.clear();
  mock.list.mockResolvedValue({ items: [post()], nextCursor: null }); mock.get.mockResolvedValue(post()); mock.create.mockResolvedValue(post()); mock.like.mockResolvedValue({ likeCount: 3 }); mock.remove.mockResolvedValue({ ok: true });
  mock.report.mockResolvedValue({ ok: true }); mock.comments.mockResolvedValue({ items: [], nextCursor: null }); mock.addComment.mockResolvedValue({ commentId: 'comment-1' }); mock.deleteComment.mockResolvedValue({ ok: true });
  mock.pick.mockResolvedValue({ uri: 'file:///photo.jpg', base64: 'encoded-image' }); mock.removeImage.mockResolvedValue(undefined);
});
afterEach(async () => { if (renderer) await act(async () => renderer.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Posts composer', () => {
  it('requires content and an explicit audience, and sends a double tap only once', async () => {
    let finish!: (value: PostItem) => void;
    mock.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount(PostComposer); expect(button('Publish post').props.disabled).toBe(true);
    await type('Post text', 'Hello'); expect(button('Publish post').props.disabled).toBe(true);
    await tap('Public');
    const publish = button('Publish post').props.onPress;
    await act(async () => { publish(); publish(); });
    expect(mock.create).toHaveBeenCalledTimes(1);
    await act(async () => finish(post()));
    expect(mock.nav.replace).toHaveBeenCalledWith('PostViewer', { postId: 'post-1' });
  });
  it('keeps text/photo and a stable id after a lost response, then retries without duplicate creation', async () => {
    mock.create.mockRejectedValueOnce(Error('network'));
    await mount(PostComposer); await type('Post text', 'Keep this draft'); await tap('Add photo'); await tap('Approved followers'); await tap('Publish post');
    const first = mock.create.mock.calls[0][0];
    expect(first.imageBase64).toBe('encoded-image'); expect(input('Post text').props.value).toBe('Keep this draft');
    expect(nodes('Image').some(node => node.props.source.uri === 'file:///photo.jpg')).toBe(true);
    await tap('Publish post'); expect(mock.create.mock.calls[1][0]).toEqual(first);
  });
  it.each(['clips-disabled', 'clips-terms-cancelled'])('preserves text/photo and retry identity when publishing returns %s', async code => {
    mock.create.mockRejectedValueOnce(Object.assign(Error(code), { code }));
    await mount(PostComposer); await type('Post text', 'Keep this draft'); await tap('Add photo'); await tap('Public'); await tap('Publish post');
    const first = mock.create.mock.calls[0][0];
    expect(input('Post text').props.value).toBe('Keep this draft');
    expect(nodes('Image').some(node => node.props.source.uri === 'file:///photo.jpg')).toBe(true);
    expect(button('Publish post').props.disabled).toBe(false); expect(mock.nav.replace).not.toHaveBeenCalled();
    if (code === 'clips-disabled') expect(JSON.stringify(renderer.toJSON())).toContain('Posts are currently unavailable.');
    else expect(nodes('Text').filter(node => node.props.accessibilityRole === 'alert')).toHaveLength(0);
    await tap('Publish post'); expect(mock.create.mock.calls[1][0]).toEqual(first);
  });
  it('discards an old account import and never publishes the old account draft after an account switch', async () => {
    let finish!: (value: {uri: string; base64: string}) => void;
    mock.pick.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount(PostComposer); await type('Post text', 'Private draft'); await tap('Public'); await tap('Add photo');
    await account('next'); await act(async () => finish({ uri: 'file:///old.jpg', base64: 'private' }));
    expect(input('Post text').props.value).toBe(''); expect(button('Publish post').props.disabled).toBe(true);
    expect(mock.removeImage).toHaveBeenCalledWith('file:///old.jpg'); expect(mock.create).not.toHaveBeenCalled();
  });
  it('does not navigate from a completed publish after leaving the screen', async () => {
    let finish!: (value: PostItem) => void;
    mock.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount(PostComposer); await type('Post text', 'Hello'); await tap('Public'); await tap('Publish post');
    await act(async () => renderer.unmount()); await act(async () => finish(post()));
    expect(mock.nav.replace).not.toHaveBeenCalled();
  });
});

describe('Posts feed and viewer', () => {
  it('ignores an old account feed request and switches to My posts including review status', async () => {
    let finish!: (value: unknown) => void;
    mock.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(PostsFeed); await account('next');
    await act(async () => finish({ items: [{ ...post(), id: 'private-old', body: 'Old private content' }], nextCursor: null }));
    expect(JSON.stringify(renderer.toJSON())).not.toContain('Old private content');
    mock.list.mockResolvedValue({ items: [{ ...post(), status: 'pending_review' }], nextCursor: null });
    const mine = nodes('Pressable').find(node => node.props.accessibilityRole === 'tab' && node.findAllByType('Text' as any).some(child => child.children.includes('My posts')))!;
    await act(async () => mine.props.onPress());
    expect(mock.list).toHaveBeenLastCalledWith({ mode: 'mine', limit: 20 });
    expect(JSON.stringify(renderer.toJSON())).toContain('Waiting for review');
  });
  it('does not replace a newly loaded post with an earlier route response', async () => {
    let finish!: (value: PostItem) => void;
    mock.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount(PostViewer, { postId: 'old' });
    mock.get.mockResolvedValue({ ...post(), id: 'new', body: 'Current content' });
    await act(async () => renderer.update(createElement(PostViewer, { navigation: mock.nav, route: { params: { postId: 'new' } } })));
    await act(async () => finish({ ...post(), id: 'old', body: 'Stale content' }));
    expect(JSON.stringify(renderer.toJSON())).toContain('Current content'); expect(JSON.stringify(renderer.toJSON())).not.toContain('Stale content');
  });
  it('allows repeated manual image retries after the server renews a lease using the same URL', async () => {
    const imageUrl = 'https://signed.invalid/same-image';
    mock.list.mockResolvedValue({ items: [{ ...post(), imageUrl, imageExpiresAtMs: Date.now() + 1000 }], nextCursor: null });
    mock.get.mockResolvedValue({ ...post(), imageUrl, imageExpiresAtMs: Date.now() + 2000 });
    await mount(PostsFeed);
    await act(async () => nodes('Image')[0].props.onError()); expect(mock.get).not.toHaveBeenCalled();
    await tap('Retry image'); expect(mock.get).toHaveBeenCalledTimes(1);
    await act(async () => nodes('Image')[0].props.onError()); expect(mock.get).toHaveBeenCalledTimes(1);
    await tap('Retry image'); expect(mock.get).toHaveBeenCalledTimes(2);
    expect(nodes('Image')[0].props.source.uri).toBe(imageUrl);
  });
  it('keeps a failed comment available with its stable retry id and prevents rapid duplicate likes', async () => {
    mock.addComment.mockRejectedValueOnce(Error('network'));
    let finish!: (value: {likeCount: number}) => void;
    mock.like.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await mount(PostViewer, { postId: 'post-1' });
    const like = button('Like post').props.onPress;
    await act(async () => { like(); like(); }); expect(mock.like).toHaveBeenCalledTimes(1);
    await act(async () => finish({ likeCount: 3 })); expect(button('Unlike post')).toBeDefined();
    await type('Comment text', 'Keep comment'); await tap('Send comment');
    expect(input('Comment text').props.value).toBe('Keep comment'); const first = mock.addComment.mock.calls[0][0];
    await tap('Send comment'); expect(mock.addComment.mock.calls[1][0]).toEqual(first); expect(input('Comment text').props.value).toBe('');
  });
  it('clears revoked media and content when an expired image lease cannot be renewed', async () => {
    mock.get.mockResolvedValueOnce({ ...post(), imageUrl: 'https://signed.invalid/old', imageExpiresAtMs: Date.now() + 1000 });
    await mount(PostViewer, { postId: 'post-1' });
    expect(JSON.stringify(renderer.toJSON())).toContain('https://signed.invalid/old');
    mock.get.mockRejectedValue(Object.assign(Error('revoked'), { code: 'functions/permission-denied' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
    expect(JSON.stringify(renderer.toJSON())).not.toContain('https://signed.invalid/old');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('A published post');
    expect(JSON.stringify(renderer.toJSON())).toContain('Post unavailable');
  });
  it('supports explicit report reasons and owner deletion while keeping a failed report open', async () => {
    mock.report.mockRejectedValueOnce(Error('network'));
    await mount(PostViewer, { postId: 'post-1' }); await tap('Report post'); await type('Report details', 'Review this'); await tap('Send report');
    expect(input('Report details').props.value).toBe('Review this'); await tap('Send report');
    expect(mock.report).toHaveBeenLastCalledWith({ postId: 'post-1', reason: 'other', details: 'Review this' });
    mock.get.mockResolvedValue({ ...post(), ownerUid: 'me', canDelete: true }); await tap('Refresh post'); await tap('Delete post');
    const actions = mock.alert.mock.calls.at(-1)![2];
    await act(async () => actions.find((item: any) => item.style === 'destructive').onPress());
    expect(mock.remove).toHaveBeenCalledWith('post-1'); expect(mock.nav.goBack).toHaveBeenCalledOnce();
  });
});

describe('Post image leases', () => {
  it('hides expired images and does not loop automatic refresh requests on image decode errors', async () => {
    const expired = vi.fn();
    await act(async () => { renderer = create(createElement(PostCard, { post: { ...post(), imageUrl: 'https://signed.invalid/image', imageExpiresAtMs: Date.now() + 1000 }, onProfile: vi.fn(), onImageExpired: expired })); });
    await act(async () => nodes('Image')[0].props.onError()); expect(expired).not.toHaveBeenCalled(); expect(button('Retry image')).toBeDefined();
    await tap('Retry image'); expect(expired).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
    expect(nodes('Image')).toHaveLength(0);
  });
});
