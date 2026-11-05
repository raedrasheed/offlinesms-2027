import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createElement, useLayoutEffect} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import type {ClipItem,ClipPlayback} from '../src/lib/clips';
const mocks=vi.hoisted(()=>({playback:vi.fn(),view:vi.fn(),play:vi.fn(),pause:vi.fn(),auth:{currentUser:{uid:'me'} as {uid:string}|null},focused:true,onAppState:undefined as undefined|((state:string)=>void),removeListener:vi.fn()}));
vi.mock('react-native',()=>({View:'View',Image:'Image',Pressable:'Pressable',Text:'Text',ActivityIndicator:'ActivityIndicator',AppState:{currentState:'active',addEventListener:(_name:string,callback:(state:string)=>void)=>{mocks.onAppState=callback;return {remove:mocks.removeListener};}},StyleSheet:{create:(s:any)=>s,absoluteFill:{},absoluteFillObject:{}}}));
vi.mock('@react-navigation/native',()=>({useIsFocused:()=>mocks.focused}));
vi.mock('expo-av',async()=>{
  const React = await import('react');
  return {
    Video: React.forwardRef((props: any, ref) => {
      React.useImperativeHandle(ref, () => ({playAsync: mocks.play, pauseAsync: mocks.pause}));
      return React.createElement('Video', props);
    }),
    ResizeMode: {COVER: 'cover'},
  };
});
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
const loadedStatus = (changes: Record<string, unknown> = {}) => ({isLoaded: true, isBuffering: false, durationMillis: 8000, positionMillis: 0, isPlaying: false, ...changes});
const tap = () => renderer!.root.findByProps({testID: 'clip-toggle-play'}).props.onPress();
const retry = () => renderer!.root.findByProps({testID: 'clip-retry'}).props.onPress();
const retryButtons = () => renderer!.root.findAllByProps({testID: 'clip-retry'});
beforeEach(()=>{vi.clearAllMocks();vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mocks.auth.currentUser={uid:'me'};mocks.focused=true;mocks.playback.mockImplementation(async()=>lease());mocks.view.mockResolvedValue({ok:true});mocks.play.mockResolvedValue(loadedStatus({isPlaying:true}));mocks.pause.mockResolvedValue(loadedStatus());});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('authorized single clip player lifecycle',()=>{
  it('keeps requesting playback when the loading poster is tapped',async()=>{
    await act(async()=>{renderer=create(createElement(ClipPlayer,props(true)));});
    expect(videos()[0].props.shouldPlay).toBe(true);
    await act(async()=>renderer!.root.findByProps({testID:'clip-toggle-play'}).props.onPress());
    expect(videos()[0].props.shouldPlay).toBe(true);
  });
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
    await act(async()=>videos()[0].props.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:500})));
    await act(async()=>{vi.advanceTimersByTime(117000); });expect(mocks.playback).toHaveBeenCalledTimes(2);expect(videos()).toHaveLength(1);
  });
  it('supports explicit pause and counts only meaningful playback once',async()=>{
    await act(async()=>{renderer=create(createElement(ClipPlayer,props(true)));});
    const status={isLoaded:true,isBuffering:false,durationMillis:8000,positionMillis:1000,isPlaying:true};await act(async()=>videos()[0].props.onPlaybackStatusUpdate(status));expect(mocks.view).not.toHaveBeenCalled();
    await act(async()=>{videos()[0].props.onPlaybackStatusUpdate({...status,positionMillis:2200});videos()[0].props.onPlaybackStatusUpdate({...status,positionMillis:2600});});expect(mocks.view).toHaveBeenCalledOnce();
    await act(async()=>renderer!.root.findByProps({testID:'clip-toggle-play'}).props.onPress());expect(videos()[0].props.shouldPlay).toBe(false);
  });

  it('explicitly starts a loaded player and uses actual playback for the tap control', async () => {
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    expect(mocks.play).not.toHaveBeenCalled();
    await act(async () => videos()[0].props.onLoad(loadedStatus()));
    // Expo forwards the same initial status again after calling onLoad.
    await act(async () => videos()[0].props.onPlaybackStatusUpdate(loadedStatus()));
    expect(mocks.play).toHaveBeenCalledOnce();
    // A load completion is not evidence that playback has begun.
    await act(async () => tap());
    expect(mocks.play).toHaveBeenCalledTimes(2);
    expect(mocks.pause).not.toHaveBeenCalled();
    expect(videos()[0].props.shouldPlay).toBe(true);
    await act(async () => videos()[0].props.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:500})));
    await act(async () => tap());
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(videos()[0].props.shouldPlay).toBe(false);
    // Native isPlaying may still be true until the pause command completes.
    await act(async () => tap());
    expect(mocks.play).toHaveBeenCalledTimes(3);
    expect(videos()[0].props.shouldPlay).toBe(true);
  });

  it('keeps an intentional pause across late load callbacks and automatic lease renewal', async () => {
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    await act(async () => videos()[0].props.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:500})));
    await act(async () => tap());
    await act(async () => videos()[0].props.onLoad(loadedStatus({isPlaying:true})));
    await act(async () => videos()[0].props.onPlaybackStatusUpdate(loadedStatus({isPlaying:true})));
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.pause).toHaveBeenCalledTimes(2);
    expect(videos()[0].props.shouldPlay).toBe(false);
    await act(async () => { vi.advanceTimersByTime(117000); });
    expect(mocks.playback).toHaveBeenCalledTimes(2);
    expect(videos()[0].props.shouldPlay).toBe(false);
    await act(async () => videos()[0].props.onLoad(loadedStatus()));
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(retryButtons()).toHaveLength(0);
    expect(videos()[0].props.shouldPlay).toBe(false);
  });

  it('preserves explicit pause when network quality selects a different video variant', async () => {
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    await act(async () => videos()[0].props.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:500})));
    await act(async () => tap());
    await act(async () => renderer!.update(createElement(ClipPlayer, {...props(true),quality:'dataSaver'})));
    expect(mocks.playback).toHaveBeenLastCalledWith({clipId:'one',quality:'dataSaver'});
    expect(videos()[0].props.shouldPlay).toBe(false);
    await act(async () => videos()[0].props.onLoad(loadedStatus()));
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.pause).toHaveBeenCalledTimes(2);
  });

  it('ignores a rejected play command after the user intentionally pauses', async () => {
    let rejectPlay!: (error: Error) => void;
    mocks.play.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPlay = reject; }));
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    await act(async () => videos()[0].props.onLoad(loadedStatus()));
    await act(async () => videos()[0].props.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:500})));
    await act(async () => tap());
    await act(async () => rejectPlay(new Error('old play failed')));
    expect(retryButtons()).toHaveLength(0);
    expect(videos()[0].props.shouldPlay).toBe(false);
  });

  it('invalidates native callbacks during render before passive cleanup on blur', async () => {
    let oldPlayer: any;
    function Screen({active}: {active: boolean}) {
      useLayoutEffect(() => {
        if (!active && oldPlayer) {
          oldPlayer.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:4000}));
          oldPlayer.onLoad(loadedStatus());
          oldPlayer.onError('late native error');
        }
      }, [active]);
      return createElement(ClipPlayer, props(active));
    }
    await act(async () => { renderer = create(createElement(Screen, {active:true})); });
    oldPlayer = videos()[0].props;
    await act(async () => renderer!.update(createElement(Screen, {active:false})));
    expect(videos()).toHaveLength(0);
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.view).not.toHaveBeenCalled();
  });

  it('ignores old native callbacks after the quality changes', async () => {
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    const oldPlayer = videos()[0].props;
    await act(async () => renderer!.update(createElement(ClipPlayer, {...props(true),quality:'dataSaver'})));
    await act(async () => {
      oldPlayer.onError('late native error');
      oldPlayer.onLoad(loadedStatus());
      oldPlayer.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:4000}));
    });
    expect(videos()).toHaveLength(1);
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.view).not.toHaveBeenCalled();
    expect(retryButtons()).toHaveLength(0);
  });

  it('ignores native callbacks after the account changes even before a render', async () => {
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    const oldPlayer = videos()[0].props;
    mocks.auth.currentUser = {uid:'other'};
    await act(async () => {
      oldPlayer.onLoad(loadedStatus());
      oldPlayer.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:4000}));
      oldPlayer.onError('late native error');
    });
    expect(mocks.play).not.toHaveBeenCalled();
    expect(mocks.view).not.toHaveBeenCalled();
    await act(async () => renderer!.update(createElement(ClipPlayer, props(true))));
    expect(mocks.playback).toHaveBeenCalledTimes(2);
    expect(retryButtons()).toHaveLength(0);
  });

  it('bounds a stalled lease, ignores its late response, and retries with fresh authorization', async () => {
    let resolveOld!: (value: ClipPlayback) => void;
    mocks.playback.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    await act(async () => { vi.advanceTimersByTime(25000); });
    expect(retryButtons()).toHaveLength(1);
    expect(videos()).toHaveLength(0);
    await act(async () => resolveOld(lease('old')));
    expect(videos()).toHaveLength(0);
    mocks.playback.mockResolvedValueOnce(lease('fresh'));
    await act(async () => retry());
    expect(mocks.playback).toHaveBeenCalledTimes(2);
    expect(videos()[0].props.source.uri).toBe('https://signed/fresh');
  });

  it('does not let repeated loaded statuses extend a stalled startup deadline', async () => {
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    await act(async () => videos()[0].props.onLoad(loadedStatus()));
    for (let n = 0; n < 4; n++) {
      await act(async () => { vi.advanceTimersByTime(5000); });
      await act(async () => videos()[0].props.onPlaybackStatusUpdate(loadedStatus({isPlaying:true})));
    }
    expect(videos()).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(videos()).toHaveLength(0);
    expect(retryButtons()).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(120000); });
    expect(mocks.playback).toHaveBeenCalledOnce();
  });

  it('clears the startup deadline only after playback advances', async () => {
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    await act(async () => videos()[0].props.onLoad(loadedStatus()));
    await act(async () => { vi.advanceTimersByTime(24000); });
    await act(async () => videos()[0].props.onPlaybackStatusUpdate(loadedStatus({isPlaying:true,positionMillis:250})));
    await act(async () => { vi.advanceTimersByTime(60000); });
    expect(videos()).toHaveLength(1);
    expect(retryButtons()).toHaveLength(0);
  });

  it('handles unloaded status errors without exposing signed URLs or raw native details', async () => {
    const secret = 'https://storage.example/clip.mp4?X-Goog-Signature=private-secret';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    const oldPlayer = videos()[0].props;
    await act(async () => oldPlayer.onPlaybackStatusUpdate({isLoaded:false,error:`native failure ${secret}`}));
    await act(async () => oldPlayer.onError(`late native failure ${secret}`));
    expect(videos()).toHaveLength(0);
    expect(retryButtons()).toHaveLength(1);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('private-secret');
    expect(JSON.stringify([warn.mock.calls,log.mock.calls,error.mock.calls])).not.toContain('private-secret');
  });

  it('ignores a late imperative rejection after manual retry', async () => {
    let rejectOld!: (error: Error) => void;
    mocks.play.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    await act(async () => { renderer = create(createElement(ClipPlayer, props(true))); });
    await act(async () => videos()[0].props.onLoad(loadedStatus()));
    await act(async () => videos()[0].props.onError('native failure'));
    mocks.playback.mockResolvedValueOnce(lease('retry'));
    await act(async () => retry());
    await act(async () => rejectOld(new Error('old command failed')));
    expect(retryButtons()).toHaveLength(0);
    expect(videos()[0].props.source.uri).toBe('https://signed/retry');
  });
});

