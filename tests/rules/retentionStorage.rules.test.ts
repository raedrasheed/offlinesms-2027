import { beforeAll, afterAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
let env: RulesTestEnvironment;
describe.skipIf(!process.env.FIREBASE_STORAGE_EMULATOR_HOST)('media retention boundary', () => {
  beforeAll(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-offlinesms',
      firestore: { host: '127.0.0.1', port: 8080, rules: readFileSync(resolve('firestore.rules'), 'utf8') },
      storage: { host: '127.0.0.1', port: 9199, rules: readFileSync(resolve('storage.rules'), 'utf8') },
    });
  });
  afterAll(async () => { await env?.cleanup(); });
  it('allows a reserved upload, but refuses missing or expiring message reservations', async () => {
    await env.withSecurityRulesDisabled(async ctx => {
      await setDoc(doc(ctx.firestore(), 'conversations/c/messages/live'), { senderUid: 'sender', type: 'image' });
      await setDoc(doc(ctx.firestore(), 'conversations/c/messages/expiring'), { senderUid: 'sender', type: 'image', retentionDeleting: true });
    });
    const storage = env.authenticatedContext('sender').storage();
    const upload = (id: string) => uploadBytes(ref(storage, `chatMedia/c/sender/${id}/image-original.jpg`), new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' });
    await assertSucceeds(upload('live'));
    await assertFails(upload('expiring'));
    await assertFails(upload('missing'));
  });
});
