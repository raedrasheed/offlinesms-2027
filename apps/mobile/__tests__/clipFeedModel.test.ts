import {describe,expect,it,vi} from 'vitest';
import {appendUniqueClips,clipQuality,loadClipWindow} from '../src/lib/clipFeedModel';
import type {ClipItem} from '../src/lib/clips';
const clip=(id:string,likeCount=0)=>({id,likeCount} as ClipItem);
describe('clips feed paging and data budget',()=>{
  it('continues past authorization-filtered empty pages without losing the cursor',async()=>{
    const load=vi.fn().mockResolvedValueOnce({items:[],nextCursor:'a'}).mockResolvedValueOnce({items:[],nextCursor:'b'}).mockResolvedValueOnce({items:[clip('visible')],nextCursor:'c'});
    const page=await loadClipWindow(load,{mode:'forYou',limit:10});
    expect(load.mock.calls.map(([input])=>input.cursor)).toEqual([undefined,'a','b']);expect(page).toEqual({items:[clip('visible')],nextCursor:'c'});
  });
  it('bounds empty scans and retains a cursor so the user can keep browsing',async()=>{
    const load=vi.fn().mockImplementation(async()=>({items:[],nextCursor:String(load.mock.calls.length)}));
    expect(await loadClipWindow(load,{mode:'following'})).toEqual({items:[],nextCursor:'4'});expect(load).toHaveBeenCalledTimes(4);
  });
  it('stops a cancelled query before fetching another filtered page',async()=>{
    let active=true;const load=vi.fn().mockImplementation(async()=>{active=false;return {items:[],nextCursor:'old'};});
    expect(await loadClipWindow(load,{mode:'forYou'},()=>active)).toEqual({items:[],nextCursor:null});expect(load).toHaveBeenCalledOnce();
  });
  it('does not loop forever on a repeated server cursor',async()=>{
    const load=vi.fn().mockResolvedValue({items:[],nextCursor:'same'});expect((await loadClipWindow(load,{mode:'forYou'})).nextCursor).toBeNull();expect(load).toHaveBeenCalledTimes(2);
  });
  it('deduplicates overlapping pages while accepting refreshed counters',()=>{
    expect(appendUniqueClips([clip('a'),clip('b')],[clip('b',3),clip('c')])).toEqual([clip('a'),clip('b',3),clip('c')]);
  });
  it('automatically saves data on cellular or unknown networks and respects an explicit choice',()=>{
    expect(clipQuality('auto','cellular')).toBe('dataSaver');expect(clipQuality('auto',null)).toBe('dataSaver');expect(clipQuality('auto','wifi')).toBe('standard');expect(clipQuality('always','wifi')).toBe('dataSaver');expect(clipQuality('never','cellular')).toBe('standard');
  });
});
