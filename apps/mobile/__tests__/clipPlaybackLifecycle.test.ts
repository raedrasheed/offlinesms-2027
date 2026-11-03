import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import type {ClipItem,ClipPlayback} from '../src/lib/clips';
const mocks=vi.hoisted(()=>({playback:vi.fn(),view:vi.fn(),auth:{currentUser:{uid:'me'} as {uid:string}|null},focused:true,onAppState:undefined as undefined|((state:string)=>void),removeListener:vi.fn()}));
vi.mock('react-native',()=>({View:'View',Image:'Image',Pressable:'Pressable',Text:'Text',ActivityIndicator:'ActivityIndicator',AppState:{currentState:'active',addEventListener:(_name:string,callback:(state:string)=>void)=>{mocks.onAppState=callback;return {remove:mocks.removeListener};}},StyleSheet:{create:(s:any)=>s,absoluteFill:{},absoluteFillObject:{}}}));
vi.mock('@react-navigation/native',()=>({useIsFocused:()=>mocks.focused}));
vi.mock('expo-av',()=>({Video:'Video',ResizeMode:{COVER:'cover'}}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
vi.mock('../src/lib/firebase',()=>({auth:mocks.auth}));
vi.mock('../src/lib/clips',()=>({getClipPlayback:mocks.playback,recordClipView:mocks.view}));
vi.mock('../src/lib/clipsCopy',()=>({useClipsCopy:()=>({c:(en:string)=>en})}));
import ClipPlayer from '../src/components/clips/ClipPlayer';
import {useClipVisibility} from '../src/hooks/useClipVisibility';
function FocusedPlayer(){const active=useClipVisibility();return createElement(ClipPlayer,props(active));}
let renderer:ReactTestRenderer|undefined;
const clip={id:'one',durationMs:8000} as ClipItem;
const lease=(suffix='one'):ClipPlayback=>({url:`https://signed/${suffix}`,thumbnailUrl:'https://signed/thumb',expiresAtMs:Date.now()+120000,durationMs:8000,quality:'standard'});
const videos=()=>renderer!.root.findAllByType('Video' as any);
const props=(active:boolean)=>({clip,active,muted:true,quality:'standard' as const,onMute:vi.fn()});
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mocks.auth.currentUser={uid:'me'};mocks.focused=true;mocks.playback.mockImplementation(async()=>lease());mocks.view.mockResolvedValue({ok:true});});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.useRealTimers();vi.unstubAllGlobals();});
describe('authorized single clip player lifecycle',()=>{
  it('releases video when the app backgrounds and prevents playback on an unfocused tab',async()=>{
    await act(async()=>{renderer=create(createElement(FocusedPlayer));});expect(videos()).toHaveLength(1);
    await act(async()=>mocks.onAppState!('background'));expect(videos()).toHaveLength(0);
    mocks.focused=false;await act(async()=>mocks.onAppState!('active'));expect(videos()).toHaveLength(0);expect(mocks.playback).toHaveBeenCalledOnce();
    mocks.focused=true;await act(async()=>renderer!.update(createElement(FocusedPlayer)));expect(videos()).toHaveLength(1);expect(mocks.playback).toHaveBeenCalledTimes(2);
    await act(async()=>renderer!.unmount());renderer=undefined;expect(mocks.removeListener).toHaveBeenCalledOnce();
  });

  it('does not resolve media offscreen, mounts one decoder while active, and releases it on blur',async()=>{
    await act(async()=>{renderer=create(createElement(ClipPlayer,props(false)));});expect(mocks.playback).not.toHaveBeenCalled();expect(videos()).toHaveLength(0);
    await act(async()=>renderer!.update(createElement(ClipPlayer,props(true))));expect(mocks.playback).toHaveBeenCalledWith({clipId:'one',quality:'standard'});expect(videos()).toHaveLength(1);expect(videos()[0].props.shouldPlay).toBe(true);
    await act(async()=>renderer!.update(createElement(ClipPlayer,props(false))));expect(videos()).toHaveLength(0);
    await act(async()=>{vi.advanceTimersByTime(120000); });expect(mocks.playback).toHaveBeenCalledOnce();
  });
  it('ignores a late playback response after going offscreen',async()=>{
    let resolve!:(value:ClipPlayback)=>void;mocks.playback.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    await act(async()=>{renderer=create(createElement(ClipPlayer,props(true)));});await act(async()=>renderer!.update(createElement(ClipPlayer,props(false))));
    await act(async()=>resolve(lease()));expect(videos()).toHaveLength(0);
  });
  it('rejects a lease resolved after account change',async()=>{
    let resolve!:(value:ClipPlayback)=>void;mocks.playback.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    await act(async()=>{renderer=create(createElement(ClipPlayer,props(true)));});mocks.auth.currentUser={uid:'other'};await act(async()=>resolve(lease()));expect(videos()).toHaveLength(0);
  });
  it('renews an expiring lease through a fresh authorization check',async()=>{
    await act(async()=>{renderer=create(createElement(ClipPlayer,props(true)));});expect(videos()).toHaveLength(1);
    await act(async()=>{vi.advanceTimersByTime(117000); });expect(mocks.playback).toHaveBeenCalledTimes(2);expect(videos()).toHaveLength(1);
  });
  it('supports explicit pause and counts only meaningful playback once',async()=>{
    await act(async()=>{renderer=create(createElement(ClipPlayer,props(true)));});
    const status={isLoaded:true,isBuffering:false,durationMillis:8000,positionMillis:1000,isPlaying:true};await act(async()=>videos()[0].props.onPlaybackStatusUpdate(status));expect(mocks.view).not.toHaveBeenCalled();
    await act(async()=>{videos()[0].props.onPlaybackStatusUpdate({...status,positionMillis:2200});videos()[0].props.onPlaybackStatusUpdate({...status,positionMillis:2600});});expect(mocks.view).toHaveBeenCalledOnce();
    await act(async()=>renderer!.root.findByProps({testID:'clip-toggle-play'}).props.onPress());expect(videos()[0].props.shouldPlay).toBe(false);
  });
});
