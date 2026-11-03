import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
const mocks=vi.hoisted(()=>({get:vi.fn(),thumb:vi.fn(),active:true}));
vi.mock('react-native',()=>({View:'View',Text:'Text',Pressable:'Pressable',Image:'Image',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:(v:any)=>v,absoluteFillObject:{}}}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
vi.mock('../src/lib/clipsCopy',()=>({useClipsCopy:()=>({c:(en:string)=>en})}));
vi.mock('../src/lib/clips',()=>({getClip:mocks.get,getClipThumbnails:mocks.thumb}));
vi.mock('../src/hooks/useClipVisibility',()=>({useClipVisibility:()=>mocks.active}));
import {ClipMessageBubble} from '../src/components/chat/ClipMessageBubble';
let renderer:ReactTestRenderer|undefined;
const props={clipId:'clip123',uid:'me',visible:true,onOpen:vi.fn(),onLongPress:vi.fn()};
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mocks.active=true;
  mocks.get.mockResolvedValue({id:'clip123',author:{displayName:'Creator'},caption:'Protected caption'});
  mocks.thumb.mockResolvedValue({items:[{clipId:'clip123',thumbnailUrl:'https://short-lease',expiresAtMs:Date.now()+120000}]});
});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.unstubAllGlobals();});
describe('chat clip access',()=>{
  it('does not resolve off-screen content, clears it on blur, and rechecks on return',async()=>{
    await act(async()=>{renderer=create(createElement(ClipMessageBubble,{...props,visible:false}));});
    expect(mocks.get).not.toHaveBeenCalled();
    await act(async()=>renderer!.update(createElement(ClipMessageBubble,props)));
    expect(JSON.stringify(renderer!.toJSON())).toContain('Protected caption');
    mocks.active=false;
    await act(async()=>renderer!.update(createElement(ClipMessageBubble,props)));
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Protected caption');
    expect(renderer!.root.findAllByType('Image' as any)).toHaveLength(0);
    mocks.get.mockRejectedValue(new Error('clip-unavailable'));mocks.active=true;
    await act(async()=>renderer!.update(createElement(ClipMessageBubble,props)));
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Protected caption');
  });
  it('ignores an old-account response after the account changes',async()=>{
    let release!:(v:any)=>void;
    mocks.get.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
    await act(async()=>{renderer=create(createElement(ClipMessageBubble,props));});
    mocks.get.mockRejectedValue(new Error('denied'));
    await act(async()=>renderer!.update(createElement(ClipMessageBubble,{...props,uid:'other'})));
    await act(async()=>release({author:{displayName:'Secret'},caption:'old account caption'}));
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('old account caption');
    expect(renderer!.root.findAllByType('Image' as any)).toHaveLength(0);
  });
  it('opens the protected viewer using the opaque ID even when unavailable',async()=>{
    mocks.get.mockRejectedValue(new Error('denied'));
    await act(async()=>{renderer=create(createElement(ClipMessageBubble,props));});
    await act(async()=>renderer!.root.findByType('Pressable' as any).props.onPress());
    expect(props.onOpen).toHaveBeenCalledWith('clip123');
    expect(mocks.thumb).not.toHaveBeenCalled();
  });
});
