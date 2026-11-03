import { beforeEach, describe, expect, it } from 'vitest';
import { db, resetEmulators, req } from './harness';
import { getOrCreateDirectConversation } from '../src/chats/getOrCreateDirectConversation';
import { sendTextMessage } from '../src/chats/sendTextMessage';
import { onMessageCreate } from '../src/chats/onMessageCreate';

beforeEach(async () => {
  await resetEmulators();
  for (const uid of ['me', 'peer']) await db().doc(`users/${uid}`).set({ status: 'active', displayName: uid });
});

describe('direct chat opening and the first message', () => {
  it('creates one empty direct chat when both participants open it concurrently', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => getOrCreateDirectConversation.run(req(
      i % 2 ? 'peer' : 'me', { otherUserId: i % 2 ? 'me' : 'peer' },
    ))));
    expect(new Set(results.map(r => r.conversationId)).size).toBe(1);
    expect(results.filter(r => r.created)).toHaveLength(1);
    expect((await db().collection('conversations').get()).size).toBe(1);
    expect((await db().collection(`conversations/${results[0].conversationId}/userState`).get()).size).toBe(2);
  });
  it('keeps a historical random conversation id and its messages', async () => {
    await db().doc('conversations/historic-random-id').set({ type: 'direct', participantUids: ['me', 'peer'], participantKey: 'me_peer', lastMessageText: 'History' });
    const opened = await getOrCreateDirectConversation.run(req('peer', { otherUserId: 'me' }));
    expect(opened).toEqual({ conversationId: 'historic-random-id', created: false });
    expect((await db().doc('conversations/historic-random-id').get()).get('lastMessageText')).toBe('History');
  });
  it('commits concurrent retry sends once and scopes local ids to the sender', async () => {
    const { conversationId } = await getOrCreateDirectConversation.run(req('me', { otherUserId: 'peer' }));
    const input = { conversationId, text: 'Hello', localId: 'retry-same-id' };
    const results = await Promise.all(Array.from({ length: 6 }, () => sendTextMessage.run(req('me', input))));
    expect(new Set(results.map(r => r.messageId)).size).toBe(1);
    expect(results.filter(r => !r.idempotent)).toHaveLength(1);
    expect((await db().collection(`conversations/${conversationId}/messages`).get()).size).toBe(1);
    const peer = await sendTextMessage.run(req('peer', { ...input, text: 'Different sender' }));
    expect(peer.messageId).not.toBe(results[0].messageId);
    expect((await sendTextMessage.run(req('me', input))).messageId).toBe(results[0].messageId);
  });
  it('leaves both inbox summaries empty until an actual message is sent', async () => {
    const opened = await getOrCreateDirectConversation.run(req('me', { otherUserId: 'peer' }));
    const ref = db().doc(`conversations/${opened.conversationId}`);
    expect((await ref.get()).data()).toMatchObject({ lastMessage: null, lastMessageText: '', lastMessageAt: null });
    for (const uid of ['me', 'peer']) {
      expect((await ref.collection('userState').doc(uid).get()).data()).toMatchObject({ unreadCount: 0, lastMessageAt: null });
    }
    expect((await ref.collection('messages').get()).empty).toBe(true);
    const reverse = await getOrCreateDirectConversation.run(req('peer', { otherUserId: 'me' }));
    expect(reverse).toMatchObject({ conversationId: opened.conversationId, created: false });
    const sent = await sendTextMessage.run(req('me', { conversationId: opened.conversationId, text: 'Hello', localId: 'first' }));
    const message = ref.collection('messages').doc(sent.messageId);
    await onMessageCreate.run({ params: { convoId: opened.conversationId, msgId: sent.messageId }, data: await message.get() } as any);
    expect((await ref.get()).get('lastMessage.messageId')).toBe(sent.messageId);
    expect((await ref.collection('userState').doc('peer').get()).get('unreadCount')).toBe(1);
    expect((await ref.collection('userState').doc('me').get()).get('unreadCount')).toBe(0);
  });
});
