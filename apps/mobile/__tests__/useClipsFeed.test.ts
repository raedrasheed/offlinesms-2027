import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import type {ClipItem,ClipPage} from '../src/lib/clips';
const mocks=vi.hoisted(()=>({feed:vi.fn(),auth:{currentUser:{uid:'me'} as {uid:string}|null}}));
vi.mock('../src/lib/firebase',()=>({auth:mocks.auth}));
vi.mock('../src/lib/clips',()=>({getClipsFeed:mocks.feed}));
import {useClipsFeed} from '../src/hooks/useClipsFeed';
let renderer:ReactTestRenderer|undefined;let state:ReturnType<typeof useClipsFeed>;
function Harness({query='',enabled=true}:{query?:string;enabled?:boolean}){state=useClipsFeed({mode:'forYou',query,enabled});return null;}
const item=(id:string)=>({id} as ClipItem);
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mocks.auth.currentUser={uid:'me'};});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.unstubAllGlobals();});
describe('clips feed lifecycle',()=>{
  it('ignores old search results arriving after a new query',async()=>{
    const pending=new Map<string,(page:ClipPage<ClipItem>)=>void>();mocks.feed.mockImplementation(input=>new Promise(resolve=>pending.set(input.query,resolve)));
    await act(async()=>{renderer=create(createElement(Harness,{query:'old'}));});
    await act(async()=>renderer!.update(createElement(Harness,{query:'new'})));expect(state.items).toEqual([]);
    await act(async()=>pending.get('new')!({items:[item('new-visible')],nextCursor:null}));expect(state.items.map(i=>i.id)).toEqual(['new-visible']);
    await act(async()=>pending.get('old')!({items:[item('private-old')],nextCursor:'stale'}));expect(state.items.map(i=>i.id)).toEqual(['new-visible']);expect(state.hasMore).toBe(false);
  });
  it('coalesces end-reached events and merges overlap while paging',async()=>{
    let complete!:(page:ClipPage<ClipItem>)=>void;mocks.feed.mockResolvedValueOnce({items:[item('a')],nextCursor:'next'}).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    await act(async()=>{renderer=create(createElement(Harness));});
    await act(async()=>{void state.loadMore();void state.loadMore();});expect(mocks.feed).toHaveBeenCalledTimes(2);expect(mocks.feed.mock.calls[1][0].cursor).toBe('next');
    await act(async()=>complete({items:[item('a'),item('b')],nextCursor:null}));expect(state.items.map(i=>i.id)).toEqual(['a','b']);expect(state.hasMore).toBe(false);
  });
  it('drops loaded metadata and in-flight pages when the screen is disabled',async()=>{
    let complete!:(page:ClipPage<ClipItem>)=>void;mocks.feed.mockResolvedValueOnce({items:[item('a')],nextCursor:'next'}).mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    await act(async()=>{renderer=create(createElement(Harness));});await act(async()=>{void state.loadMore();});
    await act(async()=>renderer!.update(createElement(Harness,{enabled:false})));expect(state.items).toEqual([]);
    await act(async()=>complete({items:[item('late')],nextCursor:null}));expect(state.items).toEqual([]);expect(state.busy).toBe(false);
  });
  it('discards results belonging to a previous account',async()=>{
    let complete!:(page:ClipPage<ClipItem>)=>void;mocks.feed.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;})).mockResolvedValue({items:[item('other')],nextCursor:null});
    await act(async()=>{renderer=create(createElement(Harness));});mocks.auth.currentUser={uid:'other'};
    await act(async()=>renderer!.update(createElement(Harness)));await act(async()=>complete({items:[item('private-me')],nextCursor:null}));expect(state.items.map(i=>i.id)).toEqual(['other']);
  });
});
