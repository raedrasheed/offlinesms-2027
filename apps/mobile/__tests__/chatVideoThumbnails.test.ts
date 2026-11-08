import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({request:vi.fn(),user:{uid:'first'}}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:()=>mock.request}));
vi.mock('../src/lib/firebase',()=>({app:{},auth:{get currentUser(){return mock.user;}}}));
import {ensureChatVideoThumbnail} from '../src/lib/chatVideoThumbnails';
let sequence=0;
const input=(id='m')=>({uid:mock.user.uid,conversationId:'c',messageId:id,source:'chatMedia/c/peer/'+id+'/video.mp4'});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));};
beforeEach(()=>{vi.clearAllMocks();mock.user={uid:`user-${++sequence}`};mock.request.mockResolvedValue({data:{state:'pending'}});});
describe('bounded chat video thumbnail requests',()=>{
  it('coalesces identical requests and suppresses repeated pending/failed requests',async()=>{
    const result=deferred<any>();mock.request.mockReturnValueOnce(result.promise);
    const one=ensureChatVideoThumbnail(input(),()=>true),two=ensureChatVideoThumbnail(input(),()=>true);
    expect(mock.request).toHaveBeenCalledOnce();result.resolve({data:{state:'pending'}});
    expect(await one).toEqual({state:'pending'});expect(await two).toEqual({state:'pending'});await flush();
    await ensureChatVideoThumbnail(input(),()=>true);expect(mock.request).toHaveBeenCalledOnce();
    mock.request.mockResolvedValueOnce({data:{state:'failed'}});
    await ensureChatVideoThumbnail(input('failed'),()=>true);await flush();await ensureChatVideoThumbnail(input('failed'),()=>true);
    expect(mock.request).toHaveBeenCalledTimes(2);
  });
  it('limits concurrent metadata calls to two and drops queued hidden cells',async()=>{
    const first=deferred<any>(),second=deferred<any>();let visible=true;
    mock.request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const a=ensureChatVideoThumbnail(input('a'),()=>true),b=ensureChatVideoThumbnail(input('b'),()=>true);
    const hidden=ensureChatVideoThumbnail(input('hidden'),()=>visible),shown=ensureChatVideoThumbnail(input('shown'),()=>true);
    expect(mock.request).toHaveBeenCalledTimes(2);visible=false;first.resolve({data:{state:'pending'}});await a;await flush();
    expect(await hidden).toBeNull();expect(await shown).toEqual({state:'pending'});expect(mock.request).toHaveBeenCalledTimes(3);
    second.resolve({data:{state:'pending'}});await b;await flush();
  });
  it('does not return or reuse another account response',async()=>{
    const old=deferred<any>();mock.request.mockReturnValueOnce(old.promise);
    const args=input(),result=ensureChatVideoThumbnail(args,()=>true);mock.user={uid:'other-'+sequence};
    old.resolve({data:{state:'ready',thumbnailURL:'https://example.test/private.jpg'}});
    expect(await result).toBeNull();await flush();
    expect(await ensureChatVideoThumbnail(args,()=>true)).toBeNull();
    await ensureChatVideoThumbnail(input(),()=>true);expect(mock.request).toHaveBeenCalledTimes(2);
  });
  it('allows a later visible entry after the cooldown without polling',async()=>{
    const now=vi.spyOn(Date,'now').mockReturnValue(100_000);
    try{
      await ensureChatVideoThumbnail(input(),()=>true);await flush();
      now.mockReturnValue(159_999);await ensureChatVideoThumbnail(input(),()=>true);expect(mock.request).toHaveBeenCalledOnce();
      now.mockReturnValue(160_001);await ensureChatVideoThumbnail(input(),()=>true);expect(mock.request).toHaveBeenCalledTimes(2);
    }finally{now.mockRestore();await flush();}
  });
  it('caches transient errors briefly and keys a changed source separately',async()=>{
    mock.request.mockRejectedValueOnce(new Error('unavailable'));
    expect(await ensureChatVideoThumbnail(input(),()=>true)).toBeNull();await flush();
    await ensureChatVideoThumbnail(input(),()=>true);expect(mock.request).toHaveBeenCalledOnce();
    await ensureChatVideoThumbnail({...input(),source:'new/source'},()=>true);expect(mock.request).toHaveBeenCalledTimes(2);await flush();
  });
  it('does not call the server for a hidden or unauthenticated account',async()=>{
    expect(await ensureChatVideoThumbnail(input(),()=>false)).toBeNull();
    expect(await ensureChatVideoThumbnail({...input(),uid:''},()=>true)).toBeNull();expect(mock.request).not.toHaveBeenCalled();
  });
});
