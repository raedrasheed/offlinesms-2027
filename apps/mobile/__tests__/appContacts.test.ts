import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({call:vi.fn()}));
vi.mock('firebase/functions',()=>({getFunctions:vi.fn(),httpsCallable:()=>mocks.call}));
vi.mock('../src/lib/firebase',()=>({app:{}}));
import {loadAppContacts,contactSearchErrorKey,mergeAppContacts} from '../src/lib/appContacts';
beforeEach(()=>{vi.clearAllMocks();});
describe('app contact client',()=>{
  const contact={uid:'target',name:'Raed',username:'raed',phones:[],emails:[]};
  it('preserves the entered substring, forwards continuation and only accepts public account cards',async()=>{
    const page={cursor:[{done:false,afterUid:'prior',query:'search:ae'}],hasMore:true};
    mocks.call.mockResolvedValue({data:{schemaVersion:2,contacts:[{...contact,phones:['1234'],emails:['secret@example.com']},{name:'phone only',phones:['1234'],emails:[]}],page}});
    const result=await loadAppContacts(' aE ',page);
    expect(mocks.call).toHaveBeenCalledWith({search:'aE',cursor:page.cursor});expect(result.contacts).toEqual([contact]);
  });
  it('rejects an older all-users endpoint instead of labelling strangers as my contacts',async()=>{
    mocks.call.mockResolvedValue({data:{contacts:[contact],page:{cursor:[],hasMore:false}}});
    await expect(loadAppContacts('')).rejects.toMatchObject({code:'functions/failed-precondition'});
    expect(contactSearchErrorKey({code:'functions/failed-precondition'})).toBe('attachments.contactServiceUnavailable');
    expect(contactSearchErrorKey({code:'functions/unavailable'})).toBe('attachments.contactSearchError');
  });
  it('deduplicates contacts across private contacts, direct chats and pages',()=>{
    expect(mergeAppContacts([contact],[contact,{...contact,name:'Updated'}])).toEqual([{...contact,name:'Updated'}]);
  });
});
