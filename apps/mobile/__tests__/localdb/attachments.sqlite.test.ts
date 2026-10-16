import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createSqlJsDb,type CountingDb} from '../support/sqljsDb';
let db:CountingDb;
vi.mock('../../src/localdb/connection',()=>({getDb:()=>db,getCurrentUid:()=> 'me'}));
vi.mock('../../src/localdb/sync/syncScheduler',()=>({kick:vi.fn(),startScheduler:vi.fn(),stopScheduler:vi.fn(),setActiveConversation:vi.fn()}));
vi.mock('../../src/localdb/sync/syncEngine',()=>({}));
vi.mock('../../src/localdb/sync/networkState',()=>({isOnline:()=>false,onConnectivityChange:()=>()=>{}}));
vi.mock('../../src/localdb/sync/firebasePull',()=>({pullMessageById:vi.fn()}));
vi.mock('../../src/lib/firebase',()=>({auth:{currentUser:{uid:'me'}}}));
vi.mock('expo-file-system',()=>({
  documentDirectory:'file:///documents/',
  getInfoAsync:vi.fn(async()=>({exists:true,isDirectory:false,size:100})),
  makeDirectoryAsync:vi.fn(async()=>{}),copyAsync:vi.fn(async()=>{}),
}));
import {queueSendAttachment} from '../../src/localdb';
import {copyAsync} from 'expo-file-system';
import {insertLocalMediaMessage,applyRemoteMessages,listMessages,insertLocalMessage} from '../../src/localdb/repositories/messagesRepo';
import {remoteMessageInput} from '../../src/localdb/sync/remoteMessage';
import {mapMessageRow} from '../../src/hooks/messageModel';
import {enqueue,claimDue,markProcessing,markFailed,retryByEntityId,requeueStaleProcessing,getById} from '../../src/localdb/repositories/outboxRepo';
beforeEach(async()=>{db=await createSqlJsDb();});afterEach(()=>db.close());
describe('attachments survive SQLite and remote reconciliation',()=>{
  it.each([
    ['image','image/PNG','image/png','png'],
    ['file',' Application/PDF; charset=binary ','application/pdf','pdf'],
  ] as const)('normalizes the %s MIME in the persisted file and queued upload',async(mediaType,inputMime,mime,ext)=>{
    const row=await queueSendAttachment({conversationId:'c',senderUid:'me',mediaType,mimeType:inputMime,fileName:'attachment.'+ext,localUri:'file:///picker/file',sizeBytes:100});
    const message=mapMessageRow(row);
    expect(message.media?.mimeType).toBe(mime);
    expect(message.media?.localUri).toMatch(new RegExp('\\.'+ext+'$'));
    expect(copyAsync).toHaveBeenCalledWith({from:'file:///picker/file',to:message.media?.localUri});
    const queued=(await claimDue())[0];
    expect(JSON.parse(queued.payload_json)).toMatchObject({mimeType:mime,localUri:message.media?.localUri});
  });
  it.each(['file','video','audio'] as const)('retains %s metadata without duplicating the optimistic row',async type=>{
    const local=await insertLocalMediaMessage({conversationId:'c',senderUid:'me',mediaType:type,fileName:'المرفق.pdf',localUri:'file:///persisted',mimeType:'application/pdf',sizeBytes:100,deviceId:'d',clientSequence:1});
    expect(mapMessageRow(local).media?.fileName).toBe('المرفق.pdf');
    await applyRemoteMessages([remoteMessageInput('remote','c',{type,senderUid:'me',clientLocalId:local.local_id,media:{fileName:'المرفق.pdf',mimeType:'application/pdf',sizeBytes:100,uploadStatus:'uploaded',downloadURL:'https://example.test/file'},createdAt:1000})]);
    const rows=await listMessages('c');expect(rows).toHaveLength(1);
    expect(mapMessageRow(rows[0])).toMatchObject({type,media:{fileName:'المرفق.pdf',localUri:'file:///persisted',uploadStatus:'uploaded'}});
  });
  it('preserves location/contact cards during history fetch',async()=>{
    await applyRemoteMessages([
      remoteMessageInput('l','c',{type:'location',senderUid:'peer',location:{latitude:0,longitude:34},createdAt:1}),
      remoteMessageInput('p','c',{type:'contact',senderUid:'peer',contact:{name:'رائد',phones:['12345'],emails:[]},createdAt:2}),
    ]);
    const msgs=(await listMessages('c')).map(mapMessageRow);
    expect(msgs.find(m=>m.id==='l')?.location).toEqual({latitude:0,longitude:34});
    expect(msgs.find(m=>m.id==='p')?.contact?.name).toBe('رائد');
  });
  it('queues metadata with no binary upload, and restores it from the local payload',async()=>{
    const row=await insertLocalMessage({conversationId:'c',senderUid:'me',type:'contact',text:'رائد',payloadJson:JSON.stringify({name:'رائد',phones:['12345'],emails:[]}),deviceId:'d',clientSequence:1});
    expect(mapMessageRow(row).contact?.phones).toEqual(['12345']);
  });
  it('keeps text sends runnable while an upload is processing and does not recover the active media lane',async()=>{
    const media=await enqueue({type:'send_attachment_message',entityId:'file',idempotencyKey:'m',payload:{}});
    await markProcessing(media.id);
    await db.run('UPDATE outbox SET updated_at = 0 WHERE id = ?',[media.id]);
    await enqueue({type:'send_message',entityId:'text',idempotencyKey:'t',payload:{}});
    expect((await claimDue(Date.now(),10,'messages')).map(r=>r.type)).toEqual(['send_message']);
    await requeueStaleProcessing(1,Date.now(),'messages');
    expect((await getById(media.id))?.status).toBe('processing');
  });
  it('explicit retry recovers dead media jobs with the original idempotency key',async()=>{
    const row=await enqueue({type:'send_attachment_message',entityId:'local',idempotencyKey:'same',payload:{}});
    await markFailed(row.id,'invalid-argument','bad',Date.now(),true);
    await retryByEntityId('local');
    expect((await claimDue())[0]).toMatchObject({id:row.id,idempotency_key:'same',status:'pending',attempt_count:0});
  });
});
