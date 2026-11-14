const fileExtensions = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);

export function createGroupAvatarUploader({ sdk, storage, currentUid, requireSession }) {
  return async function uploadGroupAvatar(conversationId, file) {
    const uid = currentUid();
    const extension = fileExtensions.get(file?.type);
    if (typeof conversationId !== 'string' || !conversationId || /[/\\\x00-\x1f\x7f]/.test(conversationId)
        || conversationId === '.' || conversationId === '..') throw new Error('invalid-conversation');
    if (!extension || !file.size || file.size >= 5 * 1024 * 1024) throw new Error('invalid-group-photo');
    const path = `groupAvatars/${conversationId}/${uid}/avatar-${crypto.randomUUID()}.${extension}`;
    const ref = sdk.ref(storage, path);
    await sdk.uploadBytes(ref, file, { contentType: file.type });
    requireSession(uid);
    const url = await sdk.getDownloadURL(ref);
    requireSession(uid);
    return url;
  };
}
