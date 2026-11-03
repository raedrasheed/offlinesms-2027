import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
const mock = vi.hoisted(() => ({ cache: vi.fn(), watch: vi.fn() }));
vi.mock('../src/media/mediaCache', () => ({ cachedMediaUri: mock.cache, onMediaCached: mock.watch }));
import { useCachedMediaUri } from '../src/hooks/useCachedMediaUri';
let renderer: ReactTestRenderer, resolved: string | null;
function Probe({ message }: any) { resolved = useCachedMediaUri(message); return null; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); mock.cache.mockResolvedValue(null); mock.watch.mockReturnValue(() => {}); });
afterEach(async () => { await act(async () => renderer?.unmount()); vi.unstubAllGlobals(); });
it('shows a received group photo without a thumbnail or a prefetched disk file', async () => {
  const message = { id: 'group-photo', conversationId: 'group', type: 'image', media: { downloadURL: 'https://test/photo', uploadStatus: 'uploaded' } };
  await act(async () => { renderer = create(createElement(Probe, { message })); });
  expect(resolved).toBe('https://test/photo');
  await act(async () => mock.watch.mock.calls[0][1]('file:///cached.png'));
  expect(resolved).toBe('file:///cached.png');
});
