import {beforeEach,describe,it,expect} from 'vitest';
import {getStorage} from 'firebase-admin/storage';
import {db,resetEmulators,req} from './harness';
import {createMediaMessage} from '../src/chats/createMediaMessage';
import {finalizeMediaMessage} from '../src/chats/finalizeMediaMessage';
import {sendTextMessage} from '../src/chats/sendTextMessage';
import {deleteMessage} from '../src/chats/deleteMessage';
import {forwardMessages} from '../src/chats/forwardMessages';
// Explicit demo bucket; never run against production.
beforeEach(async()=>{await resetEmulators();await db().doc('conversations/attachment-test').set({type:'group',participantUids:['me','peer']});await db().doc('conversations/attachment-test/members/me').set({role:'member',status:'active'});});
const data={conversationId:'attachment-test',type:'file',fileName:'report.pdf',mimeType:'application/pdf',sizeBytes:9,localId:'same'};
describe('attachment handlers',()=>{
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
