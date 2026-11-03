import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({call:vi.fn(),alert:vi.fn(),auth:{currentUser:{uid:'viewer'}},buttons:[]as any[]}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:(_:unknown,name:string)=>async(args:unknown)=>({data:await state.call(name,args)})}));
vi.mock('firebase/auth',()=>({onAuthStateChanged:()=>()=>{}}));
vi.mock('../src/lib/firebase',()=>({app:{},auth:state.auth}));
vi.mock('i18next',()=>({default:{resolvedLanguage:'ar',language:'ar'}}));
vi.mock('react-native',()=>({Platform:{OS:'android'},Alert:{alert:(title:string,body:string,buttons:any[])=>{state.buttons=buttons;state.alert(title,body,buttons);}}}));
import {setClipInteraction,recordClipView} from '../src/lib/clips';
const required=()=>Object.assign(new Error('clips-terms-required'),{code:'functions/failed-precondition'});
beforeEach(()=>{vi.clearAllMocks();state.buttons=[];let attempted=false;state.call.mockImplementation(async name=>{
  if(name==='getClipsConfig')return {config:{enabled:true,termsVersion:'clips-v1'},termsAccepted:false};
  if(name==='acceptClipsTerms')return {ok:true};
  if(!attempted){attempted=true;throw required();}return {ok:true,likeCount:3};
});});
describe('Clips callable consent integration',()=>{
  it('shows localized complete terms before accepting and replaying an explicit like',async()=>{
    const result=setClipInteraction('clip','like',true);await vi.waitFor(()=>expect(state.alert).toHaveBeenCalledOnce());
    expect(state.alert.mock.calls[0][0]).toBe('شروط مجتمع المقاطع');expect(state.alert.mock.calls[0][1]).toContain('الفيديوهات والتعليقات');expect(state.alert.mock.calls[0][1]).toContain('clips-v1');
    expect(state.call.mock.calls.some(([name])=>name==='acceptClipsTerms')).toBe(false);
    state.buttons.find(button=>button.text==='أوافق').onPress();await expect(result).resolves.toEqual({ok:true,likeCount:3});
    expect(state.call.mock.calls.map(([name])=>name)).toEqual(['setClipInteraction','getClipsConfig','getClipsConfig','acceptClipsTerms','setClipInteraction']);
    expect(state.call.mock.calls.find(([name])=>name==='acceptClipsTerms')?.[1]).toEqual({version:'clips-v1',expectedUid:'viewer'});
    expect(state.call.mock.calls.at(-1)?.[1]).toEqual({clipId:'clip',type:'like',active:true});
  });
  it('cancel leaves the clip interaction unmodified and does not accept terms',async()=>{
    const result=setClipInteraction('clip','save',true);const rejected=expect(result).rejects.toMatchObject({code:'clips-terms-cancelled'});
    await vi.waitFor(()=>expect(state.alert).toHaveBeenCalledOnce());state.buttons.find(button=>button.style==='cancel').onPress();await rejected;
    expect(state.call.mock.calls.map(([name])=>name)).toEqual(['setClipInteraction','getClipsConfig']);
  });
  it('background view analytics cannot open a terms dialog',async()=>{
    await expect(recordClipView('clip')).rejects.toThrow('clips-terms-required');expect(state.alert).not.toHaveBeenCalled();expect(state.call).toHaveBeenCalledOnce();
  });
});
