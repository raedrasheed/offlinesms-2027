import {beforeEach,describe,it,expect} from 'vitest';
import {getStorage} from 'firebase-admin/storage';
import {db,resetEmulators,req} from './harness';
import {createMediaMessage} from '../src/chats/createMediaMessage';
import {finalizeMediaMessage} from '../src/chats/finalizeMediaMessage';
import {sendTextMessage} from '../src/chats/sendTextMessage';
import {deleteMessage} from '../src/chats/deleteMessage';
import {forwardMessages} from '../src/chats/forwardMessages';
import {getOrCreateDirectConversation} from '../src/chats/getOrCreateDirectConversation';
import {listAppContacts} from '../src/contacts/listAppContacts';
// Explicit demo bucket; never run against production.
beforeEach(async()=>{await resetEmulators();await db().doc('conversations/attachment-test').set({type:'group',participantUids:['me','peer']});await db().doc('conversations/attachment-test/members/me').set({role:'member',status:'active'});});
const data={conversationId:'attachment-test',type:'file',fileName:'report.pdf',mimeType:'application/pdf',sizeBytes:9,localId:'same'};
describe('attachment handlers',()=>{
  it('paginates a public-only directory and name/username search without leaking legacy PII',async()=>{
    const batch=db().batch();
    for(let i=0;i<31;i++) batch.set(db().doc(`users/account-${String(i).padStart(2,'0')}`),{
      displayName:'Raed Test',username:`raed${i}`,usernameLower:`raed${i}`,status:'active',
      email:'private@example.com',phoneNumber:'+970599123456',pinHash:'private-pin',pinSalt:'private-salt',
    });
    batch.set(db().doc('users/suspended'),{displayName:'Raed Test',username:'raed_off',usernameLower:'raed_off',status:'suspended'});
    await batch.commit();
    const first=await listAppContacts.run(req('me',{}));
    expect(first.contacts).toHaveLength(30);expect(first.page.hasMore).toBe(true);
    const second=await listAppContacts.run(req('me',{cursor:first.page.cursor}));
    expect(second.contacts).toHaveLength(1);expect(second.page.hasMore).toBe(false);
    for(const c of [...first.contacts,...second.contacts]) {
      expect(Object.keys(c).sort()).toEqual(['uid','name','username','phones','emails'].sort());
      expect(c.phones).toEqual([]);expect(c.emails).toEqual([]);
    }
    expect(JSON.stringify([first,second])).not.toMatch(/private@example|private-pin|private-salt|970599/);
    for(const search of ['RAED','@raed']) {
      const page1=await listAppContacts.run(req('me',{search}));
      const page2=await listAppContacts.run(req('me',{search,cursor:page1.page.cursor}));
      // Name and username queries may cover different first pages; the union
      // is de-duplicated within each response and again by the mobile picker.
      expect(page1.contacts.length).toBeGreaterThanOrEqual(30);
      expect(page1.contacts.length).toBeLessThanOrEqual(31);
      expect(page1.page.hasMore).toBe(true);expect(page2.page.hasMore).toBe(false);
      expect(page1.contacts.every(c=>c.uid!=='suspended')).toBe(true);
      expect(page2.contacts.every(c=>c.uid!=='suspended')).toBe(true);
      expect(new Set([...page1.contacts,...page2.contacts].map(c=>c.uid)).size).toBe(31);
    }
    await db().doc('users/arabic').set({displayName:'رائد رشيد',status:'active'});
    const arabic=await listAppContacts.run(req('me',{search:'رائد'}));
    expect(arabic.contacts).toEqual([{uid:'arabic',name:'رائد رشيد',phones:[],emails:[]}]);
  });
  it('requires directory authentication and rejects malformed pagination/search input',async()=>{
    await expect(listAppContacts.run(req(null,{}))).rejects.toMatchObject({code:'unauthenticated'});
    for(const data of [{search:'a'.repeat(81)},{search:5},{cursor:{}},{cursor:[]},{cursor:[{done:false,afterUid:'nested/path'}]},{search:'@raed',cursor:[{done:false,afterUid:'account'}]}]) {
      await expect(listAppContacts.run(req('me',data))).rejects.toMatchObject({code:'invalid-argument'});
    }
  });
  it('shares the actual public account, forwards its identity and opens a direct chat',async()=>{
    await db().doc('users/shared-user').set({displayName:'رائد',username:'raed',status:'active',email:'must-not-copy@example.com',phoneNumber:'+970599123456'});
    const sent=await sendTextMessage.run(req('me',{conversationId:'attachment-test',kind:'contact',localId:'app-card',contact:{uid:'shared-user',name:'Spoofed admin',username:'forged',phones:['12345'],emails:['fake@example.com']}}));
    const stored=await db().doc(`conversations/attachment-test/messages/${sent.messageId}`).get();
    const expected={uid:'shared-user',name:'رائد',username:'raed',phones:[],emails:[]};
    expect(stored.get('contact')).toEqual(expected);
    expect(stored.get('text')).toBe('👤 رائد\nOfflineSMS · @raed');
    await db().doc('conversations/target').set({type:'direct',participantUids:['me','peer']});
    await forwardMessages.run(req('me',{sourceConversationId:'attachment-test',messageIds:[sent.messageId],targetConversationIds:['target']}));
    const forwarded=await db().collection('conversations/target/messages').get();
    expect(forwarded.docs[0].get('contact')).toEqual(expected);
    const opened=await getOrCreateDirectConversation.run(req('peer',{otherUserId:forwarded.docs[0].get('contact.uid')}));
    expect((await db().doc(`conversations/${opened.conversationId}`).get()).get('participantUids')).toEqual(['peer','shared-user']);
    const again=await getOrCreateDirectConversation.run(req('peer',{otherUserId:'shared-user'}));
    expect(again.conversationId).toBe(opened.conversationId);
    await db().doc('users/shared-user').update({status:'suspended'});
    await expect(getOrCreateDirectConversation.run(req('peer',{otherUserId:'shared-user'}))).rejects.toMatchObject({code:'not-found'});
    await expect(getOrCreateDirectConversation.run(req('me',{otherUserId:'shared-user'}))).rejects.toMatchObject({code:'not-found'});
    await db().doc('users/shared-user').delete();
    await expect(sendTextMessage.run(req('me',{conversationId:'attachment-test',kind:'contact',localId:'app-card',contact:expected}))).resolves.toMatchObject({messageId:sent.messageId,idempotent:true});
  });
  it('rejects missing or suspended app contacts and still accepts legacy phone cards',async()=>{
    const payload={conversationId:'attachment-test',kind:'contact',contact:{uid:'missing',name:'User'}};
    await expect(sendTextMessage.run(req('me',payload))).rejects.toThrow('contact-user-unavailable');
    await db().doc('users/missing').set({displayName:'Suspended',status:'suspended'});
    await expect(sendTextMessage.run(req('me',payload))).rejects.toThrow('contact-user-unavailable');
    await expect(sendTextMessage.run(req('outsider',payload))).rejects.toMatchObject({code:'permission-denied'});
    expect((await db().collection('conversations/attachment-test/messages').get()).empty).toBe(true);
    await expect(sendTextMessage.run(req('me',{...payload,contact:{name:'Legacy contact',phones:['12345'],emails:[]}}))).resolves.toHaveProperty('messageId');
  });
  it('enforces permissions and validates structured cards',async()=>{
    await expect(sendTextMessage.run(req('outsider',{conversationId:'attachment-test',kind:'location',location:{latitude:31,longitude:34}}))).rejects.toMatchObject({code:'permission-denied'});
    await expect(sendTextMessage.run(req('me',{conversationId:'attachment-test',kind:'location',location:{latitude:100,longitude:34}}))).rejects.toMatchObject({code:'invalid-argument'});
    const sent=await sendTextMessage.run(req('me',{conversationId:'attachment-test',kind:'contact',contact:{name:'رائد',phones:['12345'],emails:[]},localId:'contact-one'}));
    expect((await db().doc(`conversations/attachment-test/messages/${sent.messageId}`).get()).data()).toMatchObject({type:'contact',contact:{name:'رائد',phones:['12345']}});
    await deleteMessage.run(req('me',{conversationId:'attachment-test',messageId:sent.messageId,mode:'for_everyone'}));
    expect((await db().doc(`conversations/attachment-test/messages/${sent.messageId}`).get()).get('contact')).toBeUndefined();
    await db().doc('conversations/attachment-test').update({'settings.onlyAdminsCanSend':true});
    await expect(createMediaMessage.run(req('me',data))).rejects.toMatchObject({code:'permission-denied'});
  });
  it('creates one reservation for concurrent retries and returns the same storage path',async()=>{
    const [a,b]=await Promise.all([createMediaMessage.run(req('me',data)),createMediaMessage.run(req('me',data))]);
    expect(a.messageId).toBe(b.messageId);expect(a.storagePath).toBe(b.storagePath);
    expect((await db().collection('conversations/attachment-test/messages').get()).size).toBe(1);
    await expect(createMediaMessage.run(req('me',{...data,fileName:'virus.exe'}))).rejects.toMatchObject({code:'invalid-argument'});
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('checks stored bytes and does not accept an arbitrary download URL',async()=>{
    const a=await createMediaMessage.run(req('me',data));
    await expect(finalizeMediaMessage.run(req('me',{conversationId:'attachment-test',messageId:a.messageId}))).rejects.toThrow('upload-missing');
    const file=getStorage().bucket().file(a.storagePath!);
    await file.save(Buffer.from('%PDF-1.7\n'),{metadata:{contentType:'application/pdf',metadata:{firebaseStorageDownloadTokens:'test-token'}}});
    const done=await finalizeMediaMessage.run(req('me',{conversationId:'attachment-test',messageId:a.messageId,downloadURL:'https://attacker.test/file',sizeBytes:1}));
    expect(done.downloadURL).toContain(encodeURIComponent(a.storagePath!));
    expect(done.downloadURL).not.toContain('attacker.test');
    expect((await db().doc(`conversations/attachment-test/messages/${a.messageId}`).get()).get('media.sizeBytes')).toBe(9);
    expect((await finalizeMediaMessage.run(req('me',{conversationId:'attachment-test',messageId:a.messageId}))).idempotent).toBe(true);
    await file.delete();
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('rejects mislabeled content and non-sender finalization',async()=>{
    const a=await createMediaMessage.run(req('me',data));const file=getStorage().bucket().file(a.storagePath!);
    await file.save(Buffer.from('MZnotPDF!'),{metadata:{contentType:'application/pdf'}});
    await expect(finalizeMediaMessage.run(req('peer',{conversationId:'attachment-test',messageId:a.messageId}))).rejects.toMatchObject({code:'permission-denied'});
    await expect(finalizeMediaMessage.run(req('me',{conversationId:'attachment-test',messageId:a.messageId}))).rejects.toThrow('file-signature-invalid');
    await file.delete();
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('copies forwarded binaries independently of the original',async()=>{
    const sent=await createMediaMessage.run(req('me',data));
    const original=getStorage().bucket().file(sent.storagePath!);
    await original.save(Buffer.from('%PDF-1.7\n'),{metadata:{contentType:'application/pdf',metadata:{firebaseStorageDownloadTokens:'original-token'}}});
    await finalizeMediaMessage.run(req('me',{conversationId:'attachment-test',messageId:sent.messageId}));
    await db().doc('conversations/target').set({type:'direct',participantUids:['me','peer']});
    await forwardMessages.run(req('me',{sourceConversationId:'attachment-test',messageIds:[sent.messageId],targetConversationIds:['target']}));
    const snap=await db().collection('conversations/target/messages').get();
    const m=snap.docs[0].data();
    expect(m).toMatchObject({type:'file',media:{fileName:'report.pdf',uploadStatus:'uploaded'}});
    expect(m.media.storagePath).not.toBe(sent.storagePath);
    expect(m.media.downloadURL).not.toContain('original-token');
    await deleteMessage.run(req('me',{conversationId:'attachment-test',messageId:sent.messageId,mode:'for_everyone'}));
    expect((await original.exists())[0]).toBe(false);
    expect((await db().doc(`conversations/attachment-test/messages/${sent.messageId}`).get()).get('media')).toBeUndefined();
    const copied=getStorage().bucket().file(m.media.storagePath);
    expect((await copied.download())[0].toString()).toBe('%PDF-1.7\n');
    await copied.delete();
  });
  it('preserves location coordinates when forwarding',async()=>{
    const sent=await sendTextMessage.run(req('me',{conversationId:'attachment-test',kind:'location',location:{latitude:31.5,longitude:34.4}}));
    await db().doc('conversations/target').set({type:'direct',participantUids:['me','peer']});
    await forwardMessages.run(req('me',{sourceConversationId:'attachment-test',messageIds:[sent.messageId],targetConversationIds:['target']}));
    const forwarded=await db().collection('conversations/target/messages').get();
    expect(forwarded.docs[0].data()).toMatchObject({type:'location',location:{latitude:31.5,longitude:34.4},forwarded:true});
  });
});
