import { beforeAll, afterAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes } from 'firebase/storage';
let env: RulesTestEnvironment;
describe.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('attachment storage boundary', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-offlinesms',
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
      storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(resolve('storage.rules'), 'utf8') },
    });
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(),'conversations/attachments-rule'),{type:'group',participantUids:['sender','peer','removed']});
      for(const uid of ['sender','peer','removed']) await setDoc(doc(ctx.firestore(),`conversations/attachments-rule/members/${uid}`),{status:uid === 'removed' ? 'removed' : 'active'});
      for(const id of ['live','expiring','file','wrong-mime','wrong-size','wrong-path']) await setDoc(doc(ctx.firestore(),`conversations/attachments-rule/messages/${id}`),{senderUid:'sender',type:'file',retentionDeleting:id==='expiring',media:{storagePath:`chatMedia/attachments-rule/sender/${id}/file.pdf`,mimeType:'application/pdf',sizeBytes:3,uploadStatus:'pending'}});
    });
  });
  afterAll(async () => { await env?.cleanup(); });
  const path=(id:string)=>`chatMedia/attachments-rule/sender/${id}/file.pdf`;
  const storage=(uid:string)=>env.authenticatedContext(uid).storage();
  it('allows a reserved upload, but refuses missing/expiring reservations and overwrites', async () => {
    const upload = (id:string) => uploadBytes(ref(storage('sender'),path(id)),new Uint8Array([1,2,3]),{contentType:'application/pdf'});
    await assertSucceeds(upload('live'));
    await assertFails(upload('live'));
    await assertFails(upload('expiring'));
    await assertFails(upload('missing'));
  });
  it('rejects non-sender writes and reservation metadata/path mismatches',async()=>{
    await assertFails(uploadBytes(ref(storage('peer'),path('file')),new Uint8Array([1,2,3]),{contentType:'application/pdf'}));
    await assertFails(uploadBytes(ref(storage('sender'),path('wrong-mime')),new Uint8Array([1,2,3]),{contentType:'image/jpeg'}));
    await assertFails(uploadBytes(ref(storage('sender'),path('wrong-size')),new Uint8Array([1,2,3,4]),{contentType:'application/pdf'}));
    await assertFails(uploadBytes(ref(storage('sender'),path('wrong-path').replace('file.pdf','another.pdf')),new Uint8Array([1,2,3]),{contentType:'application/pdf'}));
  });
  it('only exposes finalized files to active conversation participants',async()=>{
    await assertSucceeds(uploadBytes(ref(storage('sender'),path('file')),new Uint8Array([1,2,3]),{contentType:'application/pdf'}));
    await assertFails(getBytes(ref(storage('peer'),path('file'))));
    await env.withSecurityRulesDisabled(async ctx=>{await updateDoc(doc(ctx.firestore(),'conversations/attachments-rule/messages/file'),{'media.uploadStatus':'uploaded'});});
    await assertSucceeds(getBytes(ref(storage('peer'),path('file'))));
    await assertFails(getBytes(ref(storage('outsider'),path('file'))));
    await assertFails(getBytes(ref(storage('removed'),path('file'))));
  });
});
