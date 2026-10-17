import {beforeEach,describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {db,req,resetEmulators,PROJECT} from './harness';
import {listAppContacts} from '../src/contacts/listAppContacts';
import {matchContacts} from '../src/contacts/matchContacts';
import {refreshAppContactSearch,syncAppContactSearch} from '../src/contacts/syncAppContactSearch';
import {contactSearchDocument} from '../src/contacts/contactSearch';

beforeEach(resetEmulators);
async function user(uid:string,fields:Record<string,unknown>={}){
  await db().doc(`users/${uid}`).set({displayName:`Name ${uid}`,status:'active',...fields});
}
async function ready(){await db().doc('appContactSearchMeta/state').set({version:1,ready:true});}
async function search(term:string){return listAppContacts.run(req('me',{search:term}));}
describe('account contact directory',()=>{
  it('lists only owned registered contacts and direct peers, without another owner or group roster',async()=>{
    for(const uid of ['saved','direct','other','group-only','stale','suspended','me'])await user(uid,{email:'secret@example.com',pinHash:'secret-pin',...(uid==='suspended'?{status:'suspended'}:{})});
    await db().doc('users/saved/userPrivate/profile').set({phoneNumber:'+970599100001'});
    await db().doc('phoneContacts/my-contact').set({ownerUid:'me',phoneE164:'+970599100001',linkedUid:'stale',isRegistered:false});
    await db().doc('phoneContacts/unregistered').set({ownerUid:'me',phoneE164:'+970599100002',linkedUid:'stale'});
    await db().doc('phoneContacts/other-contact').set({ownerUid:'other-owner',linkedUid:'other'});
    await db().doc('phoneContacts/inactive').set({ownerUid:'me',linkedUid:'suspended'});
    await db().doc('conversations/direct-1').set({type:'direct',participantUids:['me','direct']});
    await db().doc('conversations/duplicate').set({type:'direct',participantUids:['me','saved']});
    await db().doc('conversations/group').set({type:'group',participantUids:['me','group-only']});
    await db().doc('conversations/other-owner').set({type:'direct',participantUids:['other-owner','other']});
    const result=await listAppContacts.run(req('me',{ownerUid:'other-owner'}));
    expect(result.schemaVersion).toBe(2);expect(result.scope).toBe('account');
    expect(result.contacts.map(c=>c.uid).sort()).toEqual(['direct','saved']);
    expect(JSON.stringify(result)).not.toMatch(/secret@example|secret-pin|970599/);
    for(const c of result.contacts){expect(c.phones).toEqual([]);expect(c.emails).toEqual([]);}
  });
  it('paginates through sparse owned contact sources rather than silently dropping later matches',async()=>{
    const batch=db().batch();
    for(let i=0;i<31;i++)batch.set(db().doc(`phoneContacts/c${String(i).padStart(2,'0')}`),{ownerUid:'me',linkedUid:i===30?'found':'missing'});
    batch.set(db().doc('users/found'),{displayName:'Found'});await batch.commit();
    const first=await listAppContacts.run(req('me',{}));expect(first.contacts).toEqual([]);expect(first.page.hasMore).toBe(true);
    const second=await listAppContacts.run(req('me',{cursor:first.page.cursor}));
    expect(second.contacts.map(c=>c.uid)).toEqual(['found']);expect(second.page.hasMore).toBe(false);
  });
  it('persists only explicitly synced matches, keeps saved aliases and excludes suspended/orphan accounts',async()=>{
    await user('found',{displayName:'Raed',username:'raed'});await user('off',{status:'suspended'});
    await db().doc('users/found/userPrivate/profile').set({phoneNumber:'+970599100001'});
    await db().doc('users/off/userPrivate/profile').set({phoneNumber:'+970599100002'});
    await db().doc('users/orphan/userPrivate/profile').set({phoneNumber:'+970599100003'});
    const phones=['+970599100001','+970599100002','+970599100003','+970599100004'];
    const readonly=await matchContacts.run(req('me',{phones}));expect(readonly.matches.map(m=>m.uid)).toEqual(['found']);
    expect((await db().collection('phoneContacts').get()).size).toBe(0);
    await matchContacts.run(req('me',{phones,saveMatches:true}));
    const saved=await db().collection('phoneContacts').get();expect(saved.size).toBe(1);
    expect(saved.docs[0].data()).toMatchObject({ownerUid:'me',linkedUid:'found'});
    const createdAt=saved.docs[0].get('createdAt');
    await saved.docs[0].ref.update({displayName:'My private alias',organizationId:'my-organization'});
    await matchContacts.run(req('me',{phones,saveMatches:true}));
    const resynced=await saved.docs[0].ref.get();
    expect(resynced.get('displayName')).toBe('My private alias');
    expect(resynced.get('organizationId')).toBe('my-organization');
    expect(resynced.get('createdAt')).toEqual(createdAt);
    expect((await listAppContacts.run(req('me',{}))).contacts.map(c=>c.uid)).toEqual(['found']);
  });
  it('requires authentication and rejects malformed and cross-query cursors',async()=>{
    await expect(listAppContacts.run(req(null,{}))).rejects.toMatchObject({code:'unauthenticated'});
    for(const data of [{search:5},{search:'a'.repeat(81)},{cursor:[]},{cursor:{}},{cursor:[{done:false},{done:false,afterUid:'nested/path'}]},{search:'raed',cursor:[{done:false,query:'search:other'}]}]) {
      await expect(listAppContacts.run(req('me',data))).rejects.toMatchObject({code:'invalid-argument'});
    }
  });
});

describe('indexed substring contact search',()=>{
  it('finds inner/last-name, Arabic, one-letter and mixed-case username matches across all accounts',async()=>{
    await user('raed',{displayName:'محمد رائد رشيد',username:'raed.rasheed'});await refreshAppContactSearch('raed');await ready();
    for(const term of ['@RASH','sheed','@ed','شيد','رائِد','a']){
      expect((await search(term)).contacts.map(c=>c.uid)).toEqual(['raed']);
    }
    expect((await search('@محمد')).contacts).toEqual([]);
    expect((await listAppContacts.run(req('me',{}))).contacts).toEqual([]); // public results are not everyone's default directory
  });
  it('paginates matches after the first 30, preserving every matching account',async()=>{
    const batch=db().batch();
    for(let i=0;i<65;i++){
      const uid=`person-${String(i).padStart(2,'0')}`,p={displayName:'Rash Name',username:`raed${i}`};
      batch.set(db().doc(`users/${uid}`),p);batch.set(db().doc(`appContactSearch/${uid}`),contactSearchDocument(uid,p)!);
    }
    await batch.commit();await ready();
    let page;const found=new Set();let calls=0;
    do {const r=await listAppContacts.run(req('me',{search:'ash',...(page?{cursor:page.cursor}:{})}));calls++;r.contacts.forEach(c=>found.add(c.uid));page=r.page;}while(page.hasMore && calls<10);
    expect(found.size).toBe(65);expect(calls).toBe(3);expect(page.hasMore).toBe(false);
  });
  it('returns a continuation for a sparse gram batch and verifies the entire substring',async()=>{
    const batch=db().batch();
    for(let i=0;i<101;i++){
      const uid=`candidate-${String(i).padStart(3,'0')}`,p={displayName:i===100?'xxneedlezz':'nee unrelated'};
      batch.set(db().doc(`users/${uid}`),p);batch.set(db().doc(`appContactSearch/${uid}`),contactSearchDocument(uid,p)!);
    }
    await batch.commit();await ready();
    const first=await search('needle');expect(first.contacts).toEqual([]);expect(first.page.hasMore).toBe(true);
    const next=await listAppContacts.run(req('me',{search:'needle',cursor:first.page.cursor}));
    expect(next.contacts.map(c=>c.uid)).toEqual(['candidate-100']);expect(next.page.hasMore).toBe(false);
  });
  it('never trusts stale index records for deleted, suspended, renamed or self profiles',async()=>{
    for(const uid of ['deleted','suspended','renamed','me']){await user(uid,{displayName:'Find Me'});await refreshAppContactSearch(uid);}
    await db().doc('users/deleted').delete();await db().doc('users/suspended').update({status:'suspended'});await db().doc('users/renamed').update({displayName:'Other'});await ready();
    expect((await search('find')).contacts).toEqual([]);
  });
  it('reads the current profile when an older trigger arrives, and removes deleted profiles',async()=>{
    await user('person',{displayName:'Latest Name',email:'secret@example.com'});
    await syncAppContactSearch.run({params:{uid:'person'},data:{before:{data:()=>({displayName:'Old'})},after:{data:()=>({displayName:'Intermediate'})}}} as any);
    const index=await db().doc('appContactSearch/person').get();expect(index.get('name')).toBe('Latest Name');expect(index.get('email')).toBeUndefined();
    await db().doc('users/person').delete();await refreshAppContactSearch('person');
    expect((await db().doc('appContactSearch/person').get()).exists).toBe(false);
  });
  it('reports an uninitialized service rather than false no-results, and backfills legacy profiles idempotently',async()=>{
    await user('legacy',{displayName:'Existing Raed',username:'oldraed',phoneNumber:'+970599100001',pinHash:'secret'});
    await expect(search('raed')).rejects.toMatchObject({code:'failed-precondition'});
    const run=(write:boolean)=>execFileSync(process.execPath,['scripts/backfillAppContactSearch.mjs','--project',PROJECT,...(write?['--write']:[])],{encoding:'utf8',timeout:30000});
    expect(run(false)).toContain('No data changed');expect((await db().collection('appContactSearch').get()).size).toBe(0);
    expect(run(true)).toContain('Contact search is ready');
    expect((await search('raed')).contacts.map(c=>c.uid)).toEqual(['legacy']);
    const index=(await db().doc('appContactSearch/legacy').get()).data();run(true);
    expect((await db().doc('appContactSearch/legacy').get()).data()).toEqual(index);
    expect(JSON.stringify(index)).not.toMatch(/970599|secret/);
  });
});
