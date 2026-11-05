import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createElement } from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import type {Message} from '../src/lib/conversations';
const mock=vi.hoisted(()=>({request:vi.fn(),hydrate:vi.fn(),database:{},user:{uid:'first'},online:true,state:'active',
  app:new Set<(value:string)=>void>(),network:new Set<(value:boolean)=>void>(),auth:new Set<(value:any)=>void>(),
  watches:[] as Array<{next:(value:any)=>void;error:()=>void;stop:ReturnType<typeof vi.fn>}>}));
vi.mock('react-native',()=>({AppState:{get currentState(){return mock.state;},addEventListener:(_event:string,listener:(value:string)=>void)=>{mock.app.add(listener);return{remove:()=>mock.app.delete(listener)};}}}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:()=>mock.request}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:(_auth:any,listener:(value:any)=>void)=>{mock.auth.add(listener);return()=>mock.auth.delete(listener);}}));
vi.mock('firebase/firestore',()=>({doc:(_db:any,...path:string[])=>path.join('/'),onSnapshot:(_doc:any,next:(value:any)=>void,error:()=>void)=>{const stop=vi.fn();mock.watches.push({next,error,stop});return stop;}}));
vi.mock('../src/lib/firebase',()=>({app:{},db:{},auth:{get currentUser(){return mock.user;}}}));
vi.mock('../src/localdb/sync/networkState',()=>({isOnline:()=>mock.online,onConnectivityChange:(listener:(value:boolean)=>void)=>{mock.network.add(listener);return()=>mock.network.delete(listener);}}));
vi.mock('../src/localdb/connection',()=>({getCurrentUid:()=>mock.user.uid,getDb:()=>mock.database}));
vi.mock('../src/localdb/repositories/messagesRepo',()=>({hydrateChatVideoThumbnail:mock.hydrate}));
import {useChatVideoThumbnail} from '../src/hooks/useChatVideoThumbnail';
let renderer:ReactTestRenderer|undefined,props:{message:Message;uid:string;visible:boolean},sequence=0;
function Probe(p:typeof props){const uri=useChatVideoThumbnail(p.message,p.uid,p.visible);return createElement('Result',{uri});}
const message=(extra:any={}):Message=>({id:'video',conversationId:'c',senderUid:'peer',type:'video',text:'',createdAt:null,
  media:{uploadStatus:'uploaded',mimeType:'video/mp4',sizeBytes:100,storagePath:'chatMedia/c/peer/video/video.mp4',downloadURL:'https://example.test/video.mp4'},...extra} as Message);
async function mount(extra:Partial<typeof props>={}){props={message:message(),uid:mock.user.uid,visible:true,...extra};await act(async()=>{renderer=create(createElement(Probe,props));});}
async function update(extra:Partial<typeof props>){props={...props,...extra};await act(async()=>renderer!.update(createElement(Probe,props)));}
const uri=()=>renderer!.root.findByType('Result' as any).props.uri;
async function snapshot(value:any,index=mock.watches.length-1){await act(async()=>mock.watches[index].next({data:()=>value}));}
async function app(state:string){mock.state=state;await act(async()=>{mock.app.forEach(listener=>listener(state));});}
async function online(value:boolean){mock.online=value;await act(async()=>{mock.network.forEach(listener=>listener(value));});}
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mock.user={uid:`hook-${++sequence}`};mock.online=true;mock.state='active';mock.watches=[];mock.request.mockResolvedValue({data:{state:'pending'}});mock.hydrate.mockResolvedValue(undefined);});
afterEach(async()=>{if(renderer)await act(async()=>renderer!.unmount());renderer=undefined;vi.unstubAllGlobals();});
describe('visible chat video first-frame thumbnails',()=>{
  it('requests a missing cover once and follows a late server update without polling',async()=>{
    await mount();expect(mock.request).toHaveBeenCalledWith({conversationId:'c',messageId:'video'});expect(uri()).toBeNull();
    expect(mock.watches).toHaveLength(1);
    await snapshot({media:{...props.message.media,thumbnailURL:'https://example.test/frame0.jpg'}});
    expect(uri()).toBe('https://example.test/frame0.jpg');expect(mock.watches[0].stop).toHaveBeenCalledOnce();
    expect(mock.hydrate).toHaveBeenCalledWith(expect.objectContaining({conversationId:'c',messageId:'video',source:props.message.media!.storagePath,thumbnailURL:'https://example.test/frame0.jpg'}),mock.database);
    await update({message:{...props.message}});expect(mock.request).toHaveBeenCalledOnce();
  });
  it('uses an existing thumbnail without a callable or listener',async()=>{
    const m=message();m.media={...m.media!,thumbnailURL:'https://example.test/existing.jpg'};await mount({message:m});
    expect(uri()).toBe(m.media.thumbnailURL);expect(mock.request).not.toHaveBeenCalled();expect(mock.watches).toHaveLength(0);
  });
  it.each(['pending','uploading','failed'])('does not queue a thumbnail for an %s upload',async uploadStatus=>{
    const m=message();m.media={...m.media!,uploadStatus:uploadStatus as any};await mount({message:m});
    expect(mock.request).not.toHaveBeenCalled();expect(uri()).toBeNull();
  });
  it('does not fetch offscreen, in background or offline; resumes only while visible',async()=>{
    await mount({visible:false});expect(mock.request).not.toHaveBeenCalled();
    mock.state='background';await update({visible:true});expect(mock.request).not.toHaveBeenCalled();
    await online(false);await app('active');expect(mock.request).not.toHaveBeenCalled();
    await online(true);expect(mock.request).toHaveBeenCalledOnce();expect(mock.watches).toHaveLength(1);
    await app('background');expect(mock.watches[0].stop).toHaveBeenCalledOnce();
    await app('active');expect(mock.request).toHaveBeenCalledOnce();expect(mock.watches).toHaveLength(2);
    await update({visible:false});expect(mock.watches[1].stop).toHaveBeenCalledOnce();
  });
  it('uses a ready callable response directly and hides it on account change',async()=>{
    mock.request.mockResolvedValueOnce({data:{state:'ready',thumbnailURL:'https://example.test/ready.jpg'}});await mount();
    expect(uri()).toBe('https://example.test/ready.jpg');expect(mock.watches).toHaveLength(0);
    mock.user={uid:'another'};await act(async()=>mock.auth.forEach(listener=>listener(mock.user)));
    expect(uri()).toBeNull();
  });
  it('ignores old message/account responses and subscriptions after a recycled row',async()=>{
    await mount();const old=mock.watches[0];
    const m=message({id:'new'});m.media={...m.media!,storagePath:'chatMedia/c/peer/new/video.mp4'};await update({message:m});
    expect(old.stop).toHaveBeenCalledOnce();await snapshot({media:{...message().media,thumbnailURL:'https://example.test/old.jpg'}},0);
    expect(uri()).toBeNull();mock.user={uid:'another-'+sequence};await act(async()=>mock.auth.forEach(listener=>listener(mock.user)));
    await snapshot({media:{...m.media,thumbnailURL:'https://example.test/other-account.jpg'}});expect(uri()).toBeNull();
    expect(mock.hydrate).not.toHaveBeenCalled();
  });
  it.each(['deleted','failed','source-changed'])('detaches a pending listener for %s state without showing a stale cover',async reason=>{
    await mount();await snapshot(reason==='deleted'?{deletedForEveryone:true,media:{...props.message.media,thumbnailURL:'https://example.test/deleted.jpg'}}
      :{media:{...props.message.media,...(reason==='failed'?{thumbnailState:'failed'}:{storagePath:'wrong/source',thumbnailURL:'https://example.test/wrong.jpg'})}});
    expect(mock.watches[0].stop).toHaveBeenCalledOnce();expect(uri()).toBeNull();
  });
  it('stops listening when the ordinary Firestore message feed supplies the cover',async()=>{
    await mount();const m={...props.message,media:{...props.message.media!,thumbnailURL:'https://example.test/live.jpg'}};
    await update({message:m});expect(uri()).toBe(m.media.thumbnailURL);expect(mock.watches[0].stop).toHaveBeenCalledOnce();
  });
  it('cleans up pending listeners on unmount',async()=>{
    await mount();await act(async()=>renderer!.unmount());renderer=undefined;
    expect(mock.watches[0].stop).toHaveBeenCalledOnce();expect(mock.app.size).toBe(0);expect(mock.network.size).toBe(0);expect(mock.auth.size).toBe(0);
  });
});
