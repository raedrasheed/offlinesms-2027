import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({uid:'a',signOut:vi.fn(),call:vi.fn(),offline:vi.fn(),unregister:vi.fn(),clear:vi.fn()}));
vi.mock('../src/lib/firebase',()=>({app:{},auth:{get currentUser(){return state.uid?{uid:state.uid}:null;},signOut:state.signOut}}));
vi.mock('firebase/auth',()=>({signInWithCustomToken:vi.fn()}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:()=>state.call}));
vi.mock('../src/services/presenceService',()=>({setOffline:state.offline}));
vi.mock('../src/lib/notifications',()=>({unregisterForPush:state.unregister}));
vi.mock('../src/lib/clipDrafts',()=>({clearClipDraftsForAccount:state.clear}));
import {deleteMyAccount} from '../src/lib/auth';
beforeEach(()=>{vi.resetAllMocks();state.uid='a';state.call.mockResolvedValue({data:{ok:true}});});
describe('account-bound clip draft erasure',()=>{
  it('clears the confirmed account drafts after the server succeeds',async()=>{
    await deleteMyAccount();
    expect(state.call).toHaveBeenCalledWith({expectedUid:'a'});
    expect(state.clear).toHaveBeenCalledWith('a');expect(state.signOut).toHaveBeenCalledOnce();
  });
  it('does not erase drafts if server deletion fails',async()=>{
    state.call.mockRejectedValue(new Error('deletion-failed'));
    await expect(deleteMyAccount()).rejects.toThrow('deletion-failed');
    expect(state.clear).not.toHaveBeenCalled();expect(state.signOut).not.toHaveBeenCalled();
  });
  it('refuses a preflight account switch and does not sign out a later account',async()=>{
    state.offline.mockImplementationOnce(async()=>{state.uid='b';});
    await expect(deleteMyAccount()).rejects.toThrow('account-changed');expect(state.call).not.toHaveBeenCalled();
    state.uid='a';state.call.mockImplementationOnce(async()=>{state.uid='b';return{data:{ok:true}};});
    await deleteMyAccount();
    expect(state.clear).toHaveBeenCalledWith('a');expect(state.signOut).not.toHaveBeenCalled();
  });
});
