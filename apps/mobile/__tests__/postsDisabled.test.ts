import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const rpc = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('../src/lib/clipsCopy', () => ({ useClipsCopy: () => ({ c: (en: string) => en }) }));
vi.mock('../src/lib/clips', () => ({ clipCall: rpc.call }));
import * as posts from '../src/lib/posts';
import { listSocialActivity, socialActivityDestination, type SocialActivityItem } from '../src/lib/socialActivity';
import ClipFeedHeader from '../src/components/clips/ClipFeedHeader';
let renderer: ReactTestRenderer | undefined;
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(async () => { if (renderer) await act(async () => { renderer!.unmount(); }); renderer = undefined; vi.unstubAllGlobals(); });
describe('retired Posts feature', () => {
  const attempts = [
    () => posts.listPosts({ mode: 'feed' }), () => posts.getPost('old'),
    () => posts.createPost({ clientId: 'new', body: 'text', audience: 'public' }),
    () => posts.setPostLike('old', true), () => posts.deletePost('old'),
    () => posts.reportPost({ postId: 'old', reason: 'spam' }), () => posts.listPostComments({ postId: 'old' }),
    () => posts.addPostComment({ postId: 'old', clientId: 'comment', text: 'text' }), () => posts.deletePostComment('old', 'comment'),
  ];
  it('refuses every legacy operation locally without making a callable request', async () => {
    for (const attempt of attempts) await expect(attempt()).rejects.toMatchObject({ code: 'functions/failed-precondition', message: 'posts-disabled' });
    expect(rpc.call).not.toHaveBeenCalled();
  });
  it('removes Posts from the header while retaining clip creation, search, notifications and profile', async () => {
    const createClip = vi.fn();
    await act(async () => { renderer = create(createElement(ClipFeedHeader, { top: 0, mode: 'forYou', enabled: true,
      onSearch: vi.fn(), onMode: vi.fn(), onCreate: createClip, onProfile: vi.fn(), onActivity: vi.fn(),
      ...({ onPosts: vi.fn() } as any) })); });
    expect(renderer!.root.findAllByProps({ accessibilityLabel: 'Posts' })).toHaveLength(0);
    for (const label of ['Search clips', 'Notifications', 'My clips profile']) expect(renderer!.root.findAllByProps({ accessibilityLabel: label })).toHaveLength(1);
    await act(async () => { renderer!.root.findByProps({ accessibilityLabel: 'Create clip' }).props.onPress(); });
    expect(createClip).toHaveBeenCalledTimes(1);
  });
  it('filters old post notifications from an older backend and refuses their destinations', async () => {
    const base = { id: 'video-like', kind: 'like', actor: { uid: 'actor' }, clipId: 'clip', postId: null } as SocialActivityItem;
    const oldLike = { ...base, id: 'old-like', kind: 'postLike' as const, postId: 'old' };
    const oldComment = { ...oldLike, id: 'old-comment', kind: 'postComment' as const };
    rpc.call.mockResolvedValue({ items: [oldLike, base, oldComment], nextCursor: 'next' });
    expect(await listSocialActivity()).toEqual({ items: [base], nextCursor: 'next' });
    expect(socialActivityDestination(oldLike)).toBeNull(); expect(socialActivityDestination(oldComment)).toBeNull();
    expect(socialActivityDestination(base)).toEqual({ screen: 'ClipViewer', params: { clipId: 'clip' } });
  });
});
