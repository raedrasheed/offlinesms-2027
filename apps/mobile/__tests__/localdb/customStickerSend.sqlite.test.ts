import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {createSqlJsDb,type CountingDb} from '../support/sqljsDb';
let db:CountingDb;
const mock=vi.hoisted(()=>({call:vi.fn(),upload:vi.fn()}));
vi.mock('../../src/localdb/connection',()=>({getDb:()=>db,getCurrentUid:()=> 'me'}));
vi.mock('firebase/functions',()=>({getFunctions:()=>({}),httpsCallable:(_:unknown,name:string)=>async(data:unknown)=>({data:await mock.call(name,data)})}));
vi.mock('expo-file-system',()=>({getInfoAsync:async()=>({exists:true,isDirectory:false,size:1234}),FileSystemUploadType:{BINARY_CONTENT:0},createUploadTask:()=>({uploadAsync:mock.upload})}));
vi.mock('../../src/lib/firebase',()=>({app:{options:{storageBucket:'demo-bucket'}},auth:{currentUser:{uid:'me',getIdToken:async()=> 'test-token'}}}));
vi.mock('../../src/media/transferProgress',()=>({setTransferProgress:vi.fn(),clearTransfer:vi.fn()}));
import {insertLocalMediaMessage,listMessages} from '../../src/localdb/repositories/messagesRepo';
import {enqueue} from '../../src/localdb/repositories/outboxRepo';
import {pushOutboxItem} from '../../src/localdb/sync/firebasePush';
import {mapMessageRow} from '../../src/hooks/messageModel';
beforeEach(async()=>{db=await createSqlJsDb();vi.clearAllMocks();mock.upload.mockResolvedValue({status:200,body:'{"downloadTokens":"test"}'});});afterEach(()=>db.close());
describe('custom sticker upload outbox',()=>{
  it('sends its presentation and dimensions, finalizes, then retries without reuploading',async()=>{
    const row=await insertLocalMediaMessage({conversationId:'c',senderUid:'me',mediaType:'image',presentation:'sticker',fileName:'sticker.png',localUri:'file:///outgoing.png',mimeType:'image/png',sizeBytes:1234,width:512,height:512,deviceId:'d',clientSequence:1});
    const job=await enqueue({type:'send_attachment_message',entityId:row.local_id,idempotencyKey:'same-key',payload:{conversationId:'c',localMessageId:row.local_id,mediaType:'image',presentation:'sticker',fileName:'sticker.png',mimeType:'image/png',localUri:row.media_local_uri,width:512,height:512}});
    mock.call.mockImplementation(async(name:string)=>name==='createMediaMessage'?{messageId:'remote',storagePath:'chatMedia/c/me/remote/image-original.png'}:{downloadURL:'https://example.test/verified.png'});
    await expect(pushOutboxItem(job)).resolves.toMatchObject({ok:true,remoteId:'remote'});
    expect(mock.call.mock.calls[0]).toEqual(['createMediaMessage',expect.objectContaining({type:'image',presentation:'sticker',mimeType:'image/png',sizeBytes:1234,width:512,height:512,idempotencyKey:'same-key'})]);
    expect(mapMessageRow((await listMessages('c'))[0]).media).toMatchObject({presentation:'sticker',uploadStatus:'uploaded',downloadURL:'https://example.test/verified.png'});
    mock.call.mockImplementation(async()=>({messageId:'remote',storagePath:'chatMedia/c/me/remote/image-original.png',uploadStatus:'uploaded',downloadURL:'https://example.test/verified.png',idempotent:true}));
    await pushOutboxItem(job);expect(mock.upload).toHaveBeenCalledOnce();
  });
});
