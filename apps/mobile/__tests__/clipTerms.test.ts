import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createClipTermsGate,isClipTermsCancellation} from '../src/lib/clipTerms';
const required=()=>Object.assign(new Error('clips-terms-required'),{code:'functions/failed-precondition'});
const terms=(version='clips-v1',accepted=false)=>({config:{enabled:true,termsVersion:version},termsAccepted:accepted});
let uid:string|undefined;let changed:((uid:string|undefined)=>void)|undefined;
const load=vi.fn(),accept=vi.fn(),confirm=vi.fn(),stop=vi.fn();
const gate=()=>createClipTermsGate({getUid:()=>uid,loadTerms:load,acceptTerms:accept,confirm,watchAccount:fn=>{changed=fn;return stop;}});
beforeEach(()=>{vi.clearAllMocks();uid='viewer';changed=undefined;load.mockResolvedValue(terms());accept.mockResolvedValue({ok:true});confirm.mockResolvedValue(true);});
describe('first-time Clips interaction terms',()=>{
  it('resumes the same first-time action once after explicit matching-version acceptance',async()=>{
    const action=vi.fn().mockRejectedValueOnce(required()).mockResolvedValue({liked:true});
    expect(await gate()(action)).toEqual({liked:true});expect(confirm).toHaveBeenCalledWith('clips-v1');expect(load).toHaveBeenCalledTimes(2);expect(accept).toHaveBeenCalledWith('clips-v1','viewer');expect(action).toHaveBeenCalledTimes(2);expect(stop).toHaveBeenCalledOnce();
  });
  it('cancelling never accepts terms or retries the rejected mutation',async()=>{
    confirm.mockResolvedValue(false);const action=vi.fn().mockRejectedValue(required());const result=gate()(action);
    await expect(result).rejects.toMatchObject({code:'clips-terms-cancelled'});expect(accept).not.toHaveBeenCalled();expect(action).toHaveBeenCalledOnce();
    expect(isClipTermsCancellation(await result.catch(error=>error))).toBe(true);
  });
  it('rejects an account switch while the dialog is open without accepting for either account',async()=>{
    confirm.mockImplementation(async()=>{uid='different';changed?.(uid);return true;});const action=vi.fn().mockRejectedValue(required());
    await expect(gate()(action)).rejects.toMatchObject({code:'clips-account-changed'});expect(accept).not.toHaveBeenCalled();expect(action).toHaveBeenCalledOnce();
  });
  it('rejects even when the original account signs back in before the dialog closes',async()=>{
    confirm.mockImplementation(async()=>{changed?.(undefined);uid='viewer';changed?.(uid);return true;});const action=vi.fn().mockRejectedValue(required());
    await expect(gate()(action)).rejects.toMatchObject({code:'clips-account-changed'});expect(accept).not.toHaveBeenCalled();
  });
  it('does not accept or retry if the version changed while reading',async()=>{
    load.mockResolvedValueOnce(terms('clips-v1')).mockResolvedValueOnce(terms('clips-v2'));const action=vi.fn().mockRejectedValue(required());
    await expect(gate()(action)).rejects.toMatchObject({code:'clips-terms-version-changed'});expect(accept).not.toHaveBeenCalled();expect(action).toHaveBeenCalledOnce();
  });
  it('propagates a server version race without retrying the mutation',async()=>{
    accept.mockRejectedValue(Object.assign(new Error('clips-terms-version-changed'),{code:'functions/failed-precondition'}));const action=vi.fn().mockRejectedValue(required());
    await expect(gate()(action)).rejects.toThrow('clips-terms-version-changed');expect(action).toHaveBeenCalledOnce();
  });
  it('deduplicates concurrent prompts and acceptance while resuming each distinct action once',async()=>{
    let answer!:(accepted:boolean)=>void;confirm.mockImplementation(()=>new Promise(resolve=>{answer=resolve;}));
    const run=gate();const like=vi.fn().mockRejectedValueOnce(required()).mockResolvedValue('like');const save=vi.fn().mockRejectedValueOnce(required()).mockResolvedValue('save');
    const liking=run(like),saving=run(save);await vi.waitFor(()=>expect(confirm).toHaveBeenCalledOnce());answer(true);
    expect(await Promise.all([liking,saving])).toEqual(['like','save']);expect(accept).toHaveBeenCalledOnce();expect(like).toHaveBeenCalledTimes(2);expect(save).toHaveBeenCalledTimes(2);
  });
  it('never retries ordinary network failures or a second terms rejection',async()=>{
    const network=vi.fn().mockRejectedValue(new Error('network'));await expect(gate()(network)).rejects.toThrow('network');expect(confirm).not.toHaveBeenCalled();
    const stale=vi.fn().mockRejectedValue(required());await expect(gate()(stale)).rejects.toThrow('clips-terms-required');expect(stale).toHaveBeenCalledTimes(2);expect(confirm).toHaveBeenCalledOnce();
  });
  it('does not prompt again if the same version was accepted on another device',async()=>{
    load.mockResolvedValue(terms('clips-v1',true));const action=vi.fn().mockRejectedValueOnce(required()).mockResolvedValue('saved');
    expect(await gate()(action)).toBe('saved');expect(confirm).not.toHaveBeenCalled();expect(accept).not.toHaveBeenCalled();
  });
});
