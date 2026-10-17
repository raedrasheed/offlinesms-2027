import {beforeEach,describe,it,expect} from 'vitest';
import {deflateSync} from 'node:zlib';
import {getStorage} from 'firebase-admin/storage';
import {db,resetEmulators,req} from './harness';
import {createMediaMessage} from '../src/chats/createMediaMessage';
import {finalizeMediaMessage} from '../src/chats/finalizeMediaMessage';
import {forwardMessages} from '../src/chats/forwardMessages';
import {deleteMessage} from '../src/chats/deleteMessage';

// Real RGBA PNGs with valid checksums, including a deliberately wrong size.
function png(side:number):Buffer {
  const chunk=(type:string,data:Buffer)=>{
    const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);
    let crc=0xffffffff;for(const byte of out.subarray(4,-4)){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
  };
  const header=Buffer.alloc(13);header.writeUInt32BE(side,0);header.writeUInt32BE(side,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(side*(side*4+1)))),chunk('IEND',Buffer.alloc(0))]);
}
beforeEach(async()=>{await resetEmulators();await db().doc('conversations/sticker-source').set({type:'group',participantUids:['me','peer']});await db().doc('conversations/sticker-source/members/me').set({role:'member',status:'active'});});
const bytes=png(512);
const data={conversationId:'sticker-source',type:'image',presentation:'sticker',mimeType:'image/png',sizeBytes:bytes.length,width:512,height:512,fileName:'sticker.png',localId:'custom-one'};
describe('custom sticker upload and lifecycle',()=>{
  it('enforces membership, group gates and bounded PNG metadata',async()=>{
    await expect(createMediaMessage.run(req('outsider',data))).rejects.toMatchObject({code:'permission-denied'});
    for(const delta of [{mimeType:'image/jpeg'},{width:2048},{height:1},{sizeBytes:3*1024*1024},{presentation:'other'}]){
      await expect(createMediaMessage.run(req('me',{...data,...delta}))).rejects.toThrow('sticker-invalid');
    }
    await db().doc('conversations/sticker-source').update({'settings.onlyAdminsCanSend':true});
    await expect(createMediaMessage.run(req('me',data))).rejects.toMatchObject({code:'permission-denied'});
    expect((await db().collection('conversations/sticker-source/messages').get()).empty).toBe(true);
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('finalizes once, forwards an independent sticker and retains that copy after source deletion',async()=>{
    const a=await createMediaMessage.run(req('me',data)),again=await createMediaMessage.run(req('me',data));
    expect(again.messageId).toBe(a.messageId);
    const file=getStorage().bucket().file(a.storagePath!);
    await file.save(bytes,{metadata:{contentType:'image/png'}});
    await finalizeMediaMessage.run(req('me',{conversationId:data.conversationId,messageId:a.messageId}));
    expect((await db().doc(`conversations/sticker-source/messages/${a.messageId}`).get()).get('media')).toMatchObject({presentation:'sticker',width:512,height:512,uploadStatus:'uploaded'});
    await expect(finalizeMediaMessage.run(req('me',{conversationId:data.conversationId,messageId:a.messageId}))).resolves.toMatchObject({idempotent:true});
    await db().doc('conversations/sticker-target').set({type:'direct',participantUids:['me','peer']});
    await forwardMessages.run(req('me',{sourceConversationId:data.conversationId,messageIds:[a.messageId],targetConversationIds:['sticker-target']}));
    const forwarded=(await db().collection('conversations/sticker-target/messages').get()).docs[0];
    expect(forwarded.get('type')).toBe('image');expect(forwarded.get('media.presentation')).toBe('sticker');
    const copy=getStorage().bucket().file(forwarded.get('media.storagePath'));
    expect((await copy.download())[0]).toEqual(bytes);
    await deleteMessage.run(req('me',{conversationId:data.conversationId,messageId:a.messageId,mode:'for_everyone'}));
    expect((await file.exists())[0]).toBe(false);expect((await copy.exists())[0]).toBe(true);
  });
  it.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('rejects a real PNG whose actual dimensions disagree with the declared sticker size',async()=>{
    const wrong=png(1024),a=await createMediaMessage.run(req('me',{...data,sizeBytes:wrong.length}));
    await getStorage().bucket().file(a.storagePath!).save(wrong,{metadata:{contentType:'image/png'}});
    await expect(finalizeMediaMessage.run(req('me',{conversationId:data.conversationId,messageId:a.messageId}))).rejects.toThrow('sticker-invalid');
    expect((await db().doc(`conversations/sticker-source/messages/${a.messageId}`).get()).get('media.uploadStatus')).toBe('pending');
  });
});
