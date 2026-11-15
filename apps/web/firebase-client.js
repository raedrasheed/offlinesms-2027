import { createPhoneAuthClient } from './phone-auth-client.js';
import { createGroupAvatarUploader } from './group-avatar-upload.js';
import { createChatAttachmentUploader } from './chat-attachment-upload.js';
import { normalizeUsername, validateUsername } from '../mobile/src/lib/username.ts';

// The web client uses the same authenticated Firestore reads and callable writes as mobile.
export const WATCH_LIMITS = Object.freeze({ conversations: 50, messages: 100 });

const REGION = 'us-central1';

function clientError(code) {
  return Object.assign(new Error(code), { code });
}

function emailAddress(email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
    throw clientError('email-invalid');
  }
  return normalized;
}

function documentId(id) {
  if (typeof id !== 'string' || !id || id === '.' || id === '..' || /[\/\\\x00-\x1f\x7f]/.test(id)) {
    throw clientError('invalid-document-id');
  }
  return id;
}

function asConversation(snapshot) {
  const data = snapshot.data();
  const participants = data.participantUids ?? data.memberIds;
  return { ...data, id: snapshot.id, participantUids: Array.isArray(participants) ? participants : [] };
}

function asMessage(snapshot) {
  const data = snapshot.data();
  const senderUid = data.senderUid ?? data.senderId;
  if (data.deletedForEveryone === true || data.retentionDeleting === true) {
    return { id: snapshot.id, senderUid, createdAt: data.createdAt, type: 'text', deletedForEveryone: true };
  }
  return { ...data, id: snapshot.id, senderUid };
}

function httpsUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function asPublicProfile(snapshot) {
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    uid: snapshot.id,
    displayName: typeof data.displayName === 'string' ? data.displayName : '',
    username: typeof data.username === 'string' ? data.username : '',
    photoURL: httpsUrl(data.photoURL),
    status: typeof data.status === 'string' ? data.status : 'active',
    profileCompleted: data.profileCompleted === true,
  };
}

export function initializeFirebaseClient(sdk, config, { appCheckSiteKey } = {}) {
  const app = sdk.initializeApp(config);
  const auth = sdk.initializeAuth(app, {
    persistence: [sdk.indexedDBLocalPersistence, sdk.browserLocalPersistence, sdk.inMemoryPersistence],
  });
  if (appCheckSiteKey) {
    sdk.initializeAppCheck(app, {
      provider: new sdk.ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  const db = sdk.initializeFirestore(app, { localCache: sdk.memoryLocalCache() });
  const functions = sdk.getFunctions(app, REGION);
  const storage = sdk.getStorage(app);

  function currentUid() {
    if (!auth.currentUser?.uid) throw clientError('sign-in-required');
    return auth.currentUser.uid;
  }

  function requireSession(uid) {
    if (currentUid() !== uid) throw clientError('account-changed');
  }

  async function invoke(name, data, options) {
    const result = await sdk.httpsCallable(functions, name, options)(data);
    return result.data;
  }

  const phoneAuth = createPhoneAuthClient({
    invoke,
    signIn: customToken => sdk.signInWithCustomToken(auth, customToken),
    isSignedIn: () => Boolean(auth.currentUser),
    useAppCheck: Boolean(appCheckSiteKey),
  });

  // The caller supplies literal names of existing public app callables. Firebase
  // attaches Auth/App Check and the callable remains the source of authorization.
  async function call(name, data) {
    if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(name)) throw clientError('invalid-callable');
    const uid = currentUid();
    const result = await invoke(name, data);
    requireSession(uid);
    return result;
  }

  function watchScoped(uid, source, onValue, onError) {
    requireSession(uid);
    let confirmed = false;
    return sdk.onSnapshot(source, { includeMetadataChanges: true }, snapshot => {
      if (auth.currentUser?.uid !== uid) return;
      // A new subscription must be authorized by the server before exposing
      // anything left in the process-local Firestore cache.
      if (!confirmed && snapshot.metadata?.fromCache) return;
      confirmed = true;
      onValue(snapshot);
    }, error => {
      if (auth.currentUser?.uid === uid) onError?.(error);
    });
  }

  function watchConversations(uid, onItems, onError) {
    const source = sdk.query(
      sdk.collection(db, 'conversations'),
      sdk.where('participantUids', 'array-contains', uid),
      sdk.orderBy('updatedAt', 'desc'),
      sdk.limit(WATCH_LIMITS.conversations),
    );
    return watchScoped(uid, source, snapshot => onItems(snapshot.docs.map(asConversation)), onError);
  }

  function watchUserState(uid, conversationId, onState, onError) {
    const source = sdk.doc(db, 'conversations', documentId(conversationId), 'userState', documentId(uid));
    return watchScoped(uid, source, snapshot => {
      onState(snapshot.exists() ? { ...snapshot.data(), uid } : null);
    }, onError);
  }

  function watchGroupRoster(uid, conversationId, collectionName, idKey, onRows, onError) {
    const source = sdk.collection(db, 'conversations', documentId(conversationId), collectionName);
    return watchScoped(uid, source, snapshot => {
      onRows(snapshot.docs.map(row => ({ ...row.data(), [idKey]: row.id })));
    }, onError);
  }

  function watchGroupInviteSettings(uid, conversationId, onSettings, onError) {
    const source = sdk.doc(db, 'conversations', documentId(conversationId), 'inviteSettings', 'current');
    return watchScoped(uid, source, snapshot => onSettings(snapshot.exists() ? snapshot.data() : null), onError);
  }

  function watchGroupJoinRequests(uid, conversationId, onRows, onError) {
    const source = sdk.query(
      sdk.collection(db, 'conversations', documentId(conversationId), 'joinRequests'),
      sdk.where('status', '==', 'pending'),
    );
    return watchScoped(uid, source, snapshot => {
      onRows(snapshot.docs.map(row => {
        const { requesterUid, requesterName, requesterPhotoURL, requestedAt } = row.data();
        return { requestId: row.id, requesterUid, requesterName, requesterPhotoURL, requestedAt };
      }));
    }, onError);
  }

  function watchThread(uid, conversationId, onState, onError) {
    const id = documentId(conversationId);
    const state = { conversation: undefined, messages: undefined, userState: undefined, role: undefined, serverMessageIds: [] };
    const unsubscribes = [];
    let stopped = false;
    let watchingMessages = false;

    function stop() {
      if (stopped) return;
      stopped = true;
      unsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
    }

    function track(unsubscribe) {
      if (stopped) unsubscribe();
      else unsubscribes.push(unsubscribe);
    }

    function fail(error) {
      if (stopped) return;
      stop();
      onError?.(error);
    }

    function publish() {
      if (stopped || !state.conversation || !state.messages || state.userState === undefined) return;
      const hidden = new Set(Array.isArray(state.userState?.deletedForMeMessageIds)
        ? state.userState.deletedForMeMessageIds : []);
      onState({ ...state, messages: state.messages.filter(message => !hidden.has(message.id)) });
    }

    track(watchScoped(uid, sdk.doc(db, 'conversations', id), snapshot => {
      if (stopped) return;
      if (!snapshot.exists()) { fail(clientError('conversation-not-found')); return; }
      const conversation = asConversation(snapshot);
      if (!conversation.participantUids.includes(uid)) { fail(clientError('not-a-participant')); return; }
      state.conversation = conversation;
      if (watchingMessages) { publish(); return; }
      watchingMessages = true;
      const source = sdk.query(
        sdk.collection(db, 'conversations', id, 'messages'),
        sdk.orderBy('createdAt', 'desc'),
        sdk.limit(WATCH_LIMITS.messages),
      );
      track(watchScoped(uid, source, messages => {
        state.messages = messages.docs.map(asMessage).reverse();
        state.serverMessageIds = messages.metadata?.fromCache ? [] : messages.docs
          .filter(message => !message.metadata?.fromCache && !message.metadata?.hasPendingWrites)
          .map(message => message.id);
        publish();
      }, fail));
      if (stopped) return;
      track(watchUserState(uid, id, userState => {
        state.userState = userState;
        publish();
      }, fail));
      if (!stopped && conversation.type === 'group') {
        track(watchScoped(uid, sdk.doc(db, 'conversations', id, 'members', documentId(uid)), member => {
          const data = member.exists() ? member.data() : null;
          state.role = data && (data.status ?? 'active') === 'active' ? data.role ?? 'member' : null;
          publish();
        }, () => { state.role = null; publish(); }));
      }
    }, fail));

    return stop;
  }

  async function getPublicProfile(uid) {
    const owner = currentUid();
    const snapshot = await sdk.getDocFromServer(sdk.doc(db, 'users', documentId(uid)));
    requireSession(owner);
    return asPublicProfile(snapshot);
  }

  async function readOwnProfile() {
    const uid = currentUid();
    const source = sdk.doc(db, 'users', documentId(uid));
    const snapshot = await sdk.getDocFromServer(source);
    requireSession(uid);
    const profile = snapshot.data();
    if (!profile || (profile.status ?? 'active') !== 'active') throw clientError('permission-denied');
    return { uid, source, profile };
  }

  async function updateOwnProfile({ displayName, username }) {
    if (displayName === undefined && username === undefined) return {};
    const { uid, source, profile } = await readOwnProfile();
    requireSession(uid);
    const name = displayName ?? profile.displayName;
    const nextName = typeof name === 'string' ? name.trim() : '';
    if (!nextName) throw clientError('display-name-required');
    if (nextName.length > 60) throw clientError('display-name-too-long');

    if (username !== undefined) {
      const nextUsername = typeof username === 'string' ? normalizeUsername(username) : '';
      if (validateUsername(nextUsername) !== 'ok') throw clientError('username-invalid');
      const about = typeof profile.about === 'string' ? profile.about : null;
      const result = await call('claimUsername', { displayName: nextName, username: nextUsername, about });
      return { displayName: nextName, username: result.username };
    }

    await sdk.updateDoc(source, { displayName: nextName, updatedAt: sdk.serverTimestamp() });
    requireSession(uid);
    return { displayName: nextName };
  }

  async function getGroupMemberProfiles(uid, memberUids) {
    requireSession(uid);
    const ids = [...new Set(memberUids.map(documentId))];
    const profiles = [];
    // Firestore's `in` operator supports up to 30 values per query.
    for (let offset = 0; offset < ids.length; offset += 30) {
      const source = sdk.query(
        sdk.collection(db, 'users'),
        sdk.where(sdk.documentId(), 'in', ids.slice(offset, offset + 30)),
      );
      const snapshot = await sdk.getDocsFromServer(source);
      requireSession(uid);
      profiles.push(...snapshot.docs.map(asPublicProfile));
    }
    return profiles;
  }

  async function findByUsername(username) {
    const owner = currentUid();
    const normalized = typeof username === 'string' ? username.trim().replace(/^@/, '').toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9._]{1,18}[a-z0-9]$/.test(normalized) || /[._]{2}/.test(normalized)) {
      throw clientError('username-invalid');
    }
    const index = await sdk.getDocFromServer(sdk.doc(db, 'usernames', normalized));
    requireSession(owner);
    if (!index.exists() || typeof index.data().uid !== 'string') return null;
    const profile = await getPublicProfile(index.data().uid);
    requireSession(owner);
    return profile?.status === 'active' && profile.username.toLowerCase() === normalized ? profile : null;
  }

  function mediaRef(storagePath) {
    const segments = typeof storagePath === 'string' ? storagePath.split('/') : [];
    if (segments.length !== 5 || segments[0] !== 'chatMedia') throw clientError('storage-path-invalid');
    segments.slice(1).forEach(documentId);
    return sdk.ref(storage, storagePath);
  }

  async function getMediaUrl(storagePath) {
    const owner = currentUid();
    const url = httpsUrl(await sdk.getDownloadURL(mediaRef(storagePath)));
    requireSession(owner);
    if (!url) throw clientError('media-url-invalid');
    return url;
  }

  async function getMediaBlob(storagePath, maxBytes) {
    const owner = currentUid();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 25 * 1024 * 1024 + 1) throw clientError('media-limit-invalid');
    const blob = await sdk.getBlob(mediaRef(storagePath), maxBytes);
    requireSession(owner);
    return blob;
  }

  const { sendAttachment, cancelUploads } = createChatAttachmentUploader({ sdk, mediaRef, currentUid, requireSession, documentId, call });

  return Object.freeze({
    watchAuth(onUser, onError) {
      return sdk.onAuthStateChanged(auth, user => {
        cancelUploads(user?.uid);
        phoneAuth.resetPhoneFlow();
        onUser(user ? { uid: user.uid, email: user.email ?? null, phoneNumber: user.phoneNumber ?? null } : null);
      }, onError);
    },
    watchAccount(uid, onAccount, onError) {
      const source = sdk.doc(db, 'users', documentId(uid));
      return watchScoped(uid, source, (snapshot) => {
        // A display-name write may be reflected locally before the server accepts it.
        if (!snapshot.metadata?.hasPendingWrites) onAccount(asPublicProfile(snapshot));
      }, onError);
    },
    async requestEmailOtp(email) {
      await invoke('requestEmailOtp', { email: emailAddress(email) });
    },
    async verifyEmailOtp(email, code) {
      if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) throw clientError('code-invalid');
      const result = await invoke('verifyEmailOtp', { email: emailAddress(email), code: code.trim() });
      const customToken = result?.customToken;
      if (typeof customToken !== 'string' || !customToken) throw clientError('signin-interrupted');
      await sdk.signInWithCustomToken(auth, customToken);
    },
    ...phoneAuth,
    signOut() {
      cancelUploads();
      phoneAuth.resetPhoneFlow();
      return sdk.signOut(auth);
    },
    watchConversations,
    watchThread,
    watchUserState,
    watchGroupMembers: (uid, id, onRows, onError) => watchGroupRoster(uid, id, 'members', 'uid', onRows, onError),
    watchGroupExternalMembers: (uid, id, onRows, onError) => watchGroupRoster(uid, id, 'externalMembers', 'contactId', onRows, onError),
    watchGroupInviteSettings,
    watchGroupJoinRequests,
    getPublicProfile,
    getGroupMemberProfiles,
    findByUsername,
    storageBucket: config.storageBucket,
    getMediaUrl,
    getMediaBlob,
    sendAttachment,
    uploadGroupAvatar: createGroupAvatarUploader({ sdk, storage, currentUid, requireSession }),
    updateOwnProfile,
    async completeInviteProfile({ username, displayName }) {
      const { uid, profile } = await readOwnProfile();
      requireSession(uid);
      if (typeof profile.username === 'string' && profile.username.trim()) return;
      const savedName = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
      const about = typeof profile.about === 'string' ? profile.about : null;
      await call('claimUsername', { username, displayName: savedName || displayName, about });
    },
    async sendText({ conversationId, text, localId, replyTo = null, mentions = null }) {
      const value = typeof text === 'string' ? text.trim() : '';
      if (!value || value.length > 4000) throw clientError(!value ? 'text-empty' : 'text-too-long');
      if (typeof localId !== 'string' || !localId || localId.length > 128) throw clientError('local-id-required');
      return call('sendTextMessage', { conversationId: documentId(conversationId), text: value, localId, replyTo, mentions });
    },
    async getPollBallot(conversationId, messageId) {
      const uid = currentUid();
      const source = sdk.doc(db, 'conversations', documentId(conversationId), 'messages', documentId(messageId), 'pollVoters', documentId(uid));
      const snapshot = await sdk.getDocFromServer(source);
      requireSession(uid);
      if (!snapshot.exists()) return null;
      const { optionIds, seq } = snapshot.data();
      if (!Array.isArray(optionIds) || !optionIds.every(id => typeof id === 'string' && id)
          || !Number.isSafeInteger(seq) || seq < 0) throw clientError('invalid-poll-ballot');
      return { optionIds, seq };
    },
    markRead: conversationId => call('markRead', { conversationId: documentId(conversationId) }),
    call,
  });
}
