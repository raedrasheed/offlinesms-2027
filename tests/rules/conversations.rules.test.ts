// Firestore rules tests — conversations, messages, userState, typing.
//
// Run with: npm run test:rules
// Requires: firebase emulators:start --only firestore

import { afterAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { asUser, asAdmin, clearAll, teardownEnv, seed } from '../helpers/rules-helpers';

afterAll(async () => { await teardownEnv(); });
beforeEach(async () => { await clearAll(); });

describe('conversations/{convoId}', () => {
  it('participant can read a direct conversation', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-a');
    await assertSucceeds(getDoc(doc(db, 'conversations', 'c-1')));
  });

  it('non-participant cannot read a direct conversation', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-c');
    await assertFails(getDoc(doc(db, 'conversations', 'c-1')));
  });

  it('admin can read any conversation', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asAdmin();
    await assertSucceeds(getDoc(doc(db, 'conversations', 'c-1')));
  });
});

describe('conversations/{convoId}/messages', () => {
  // F3: messages are created ONLY via the sendTextMessage callable (Admin SDK).
  // A direct client create — even a well-formed one from a real participant —
  // must be denied so the callable's send-policy + blocked-user gates can't be
  // bypassed by writing straight to Firestore.
  it('participant CANNOT directly create a message (callable-only)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-a');
    await assertFails(addDoc(collection(db, 'conversations/c-1/messages'), {
      type: 'text', senderUid: 'u-a', text: 'hello',
    }));
  });

  it('participant can still READ messages', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
      await setDoc(doc(db, 'conversations/c-1/messages/m-1'), {
        type: 'text', senderUid: 'u-b', text: 'hi',
      });
    });
    const db = await asUser('u-a');
    await assertSucceeds(getDoc(doc(db, 'conversations/c-1/messages/m-1')));
  });

  it('participant cannot send message as someone else', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-a');
    await assertFails(addDoc(collection(db, 'conversations/c-1/messages'), {
      type: 'text', senderUid: 'u-b', text: 'forged',
    }));
  });

  it('non-participant cannot send message', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-c');
    await assertFails(addDoc(collection(db, 'conversations/c-1/messages'), {
      type: 'text', senderUid: 'u-c', text: 'intruder',
    }));
  });

  it('non-participant cannot read messages', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
      await setDoc(doc(db, 'conversations/c-1/messages/m-1'), {
        type: 'text', senderUid: 'u-a', text: 'private',
      });
    });
    const db = await asUser('u-c');
    await assertFails(getDoc(doc(db, 'conversations/c-1/messages/m-1')));
  });

  it('participant cannot update or delete another message (callable-only)', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
      await setDoc(doc(db, 'conversations/c-1/messages/m-1'), {
        type: 'text', senderUid: 'u-a', text: 'hi',
      });
    });
    const db = await asUser('u-a');
    await assertFails(updateDoc(doc(db, 'conversations/c-1/messages/m-1'), { text: 'edited' }));
  });
});

describe('conversations/{convoId}/userState/{uid}', () => {
  it('user can update own state with allowed fields', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-a');
    await assertSucceeds(setDoc(doc(db, 'conversations/c-1/userState/u-a'), {
      uid: 'u-a', pinned: true, favorite: true, updatedAt: new Date(),
    }));
  });

  it('user cannot write another user state', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-a');
    await assertFails(setDoc(doc(db, 'conversations/c-1/userState/u-b'), {
      uid: 'u-b', pinned: true,
    }));
  });

  it('user cannot set server-owned fields like unreadCount', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-a');
    await assertFails(setDoc(doc(db, 'conversations/c-1/userState/u-a'), {
      uid: 'u-a', unreadCount: 0,
    }));
  });
});

describe('conversations/{convoId}/typing/{uid}', () => {
  it('user can write own typing state', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-a');
    await assertSucceeds(setDoc(doc(db, 'conversations/c-1/typing/u-a'), {
      isTyping: true, expiresAt: new Date(Date.now() + 5_000),
    }));
  });

  it('user cannot write another user typing state', async () => {
    await seed(async db => {
      await setDoc(doc(db, 'conversations', 'c-1'), {
        type: 'direct', participantUids: ['u-a', 'u-b'],
      });
    });
    const db = await asUser('u-a');
    await assertFails(setDoc(doc(db, 'conversations/c-1/typing/u-b'), {
      isTyping: true,
    }));
  });
});
