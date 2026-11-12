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
    persistence: [sdk.browserSessionPersistence, sdk.inMemoryPersistence],
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

  async function invoke(name, data) {
    const result = await sdk.httpsCallable(functions, name)(data);
    return result.data;
  }

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

  function watchThread(uid, conversationId, onState, onError) {
    const id = documentId(conversationId);
    const state = { conversation: undefined, messages: undefined, userState: undefined, role: undefined };
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

  async function getMediaUrl(storagePath) {
    const owner = currentUid();
    const segments = typeof storagePath === 'string' ? storagePath.split('/') : [];
    if (segments.length !== 5 || segments[0] !== 'chatMedia') throw clientError('storage-path-invalid');
    segments.slice(1).forEach(documentId);
    const url = httpsUrl(await sdk.getDownloadURL(sdk.ref(storage, storagePath)));
    requireSession(owner);
    if (!url) throw clientError('media-url-invalid');
    return url;
  }

  return Object.freeze({
    watchAuth(onUser, onError) {
      return sdk.onAuthStateChanged(auth, user => onUser(user ? { uid: user.uid, email: user.email ?? null } : null), onError);
    },
    watchAccount(uid, onAccount, onError) {
      const source = sdk.doc(db, 'users', documentId(uid));
      return watchScoped(uid, source, (snapshot) => onAccount(asPublicProfile(snapshot)), onError);
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
    signOut: () => sdk.signOut(auth),
    watchConversations,
    watchThread,
    watchUserState,
    getPublicProfile,
    findByUsername,
    getMediaUrl,
    async sendText({ conversationId, text, localId, replyTo = null, mentions = null }) {
      const value = typeof text === 'string' ? text.trim() : '';
      if (!value || value.length > 4000) throw clientError(!value ? 'text-empty' : 'text-too-long');
      if (typeof localId !== 'string' || !localId || localId.length > 128) throw clientError('local-id-required');
      return call('sendTextMessage', { conversationId: documentId(conversationId), text: value, localId, replyTo, mentions });
    },
    markRead: conversationId => call('markRead', { conversationId: documentId(conversationId) }),
    call,
  });
}
