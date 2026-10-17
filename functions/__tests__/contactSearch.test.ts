import { describe,it,expect } from 'vitest';
import {contactSearchDocument,contactMatches,normalizeContactSearch,publicAppContact} from '../src/contacts/contactSearch';

describe('contact substring search',()=>{
  const contact={uid:'person',name:'محمد رائد رشيد',username:'raed.rasheed',phones:[],emails:[]};
  it.each(['raed','RAED','@rash','sheed','@ed','شيد','رائِد','رائـد'])('matches the contained letters %s',search=>{
    expect(contactMatches(contact,search)).toBe(true);
  });
  it('restricts @ searches to the username and rejects noncontiguous letters',()=>{
    expect(contactMatches(contact,'@محمد')).toBe(false);
    expect(contactMatches(contact,'rshd')).toBe(false);
    expect(normalizeContactSearch('  RÁEd  ')).toBe('raed');
  });
  it('indexes only public fields and bounds the number of index entries',()=>{
    const index=contactSearchDocument('person',{displayName:'رائد رشيد',username:'raed.rasheed',email:'private@example.com',phoneNumber:'+970599123456',pinHash:'secret'});
    expect(Object.keys(index!).sort()).toEqual(['name','username','terms','version'].sort());
    expect(index!.terms).toContain('she');expect(index!.terms).toContain('شيد');expect(index!.terms).toContain('a');
    expect(JSON.stringify(index)).not.toMatch(/private@example|970599|secret/);
    expect(contactSearchDocument('person',{displayName:'a'.repeat(2000),username:'raed'})!.terms.length).toBeLessThanOrEqual(540);
  });
  it('accepts legacy public username casing while rejecting suspended and missing profiles',()=>{
    expect(publicAppContact('person',{displayName:'R',username:'Raed'})).toMatchObject({username:'raed',phones:[],emails:[]});
    expect(publicAppContact('person',{displayName:'R',status:'suspended'})).toBeNull();
    expect(contactSearchDocument('person',undefined)).toBeNull();
  });
});
