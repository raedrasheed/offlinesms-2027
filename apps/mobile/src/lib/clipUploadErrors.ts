export type ClipUploadStage = 'terms' | 'draft' | 'initialize' | 'read' | 'upload' | 'publish';

const codes = [
  'clip-upload-cancelled', 'storage/canceled', 'functions/cancelled',
  'clip-session-changed', 'clip-draft-owner-mismatch', 'clips-account-changed',
  'sign-in-required', 'storage/unauthenticated', 'functions/unauthenticated',
  'auth/user-token-expired', 'auth/id-token-expired', 'auth/invalid-user-token',
  'storage/unauthorized', 'functions/permission-denied',
  'account-unavailable', 'clips-account-suspended', 'clip-group-membership-required',
  'clip-file-missing', 'local-file-missing', 'file/not-found', 'clip-file-too-large',
  'clip-file-invalid', 'clip-source-invalid', 'storage/invalid-checksum', 'storage/invalid-argument',
  'clip-trim-invalid', 'clip-overlay-invalid', 'clip-mute-invalid', 'clip-options-invalid', 'audience-invalid',
  'clip-upload-daily-limit', 'clips-rate-limited', 'functions/resource-exhausted', 'storage/quota-exceeded',
  'clips-terms-required', 'clips-terms-version-changed', 'clips-disabled',
  'storage/retry-limit-exceeded', 'functions/deadline-exceeded', 'functions/unavailable', 'auth/network-request-failed',
  'clip-upload-incomplete', 'clip-draft-closed', 'clip-cannot-publish', 'clip-unavailable',
  'storage/no-default-bucket', 'storage/no-bucket', 'storage/bucket-not-found', 'storage/project-not-found', 'storage/object-not-found',
  'clip-drafts-unavailable', 'clip-upload-failed',
] as const;
export type ClipUploadErrorCode = typeof codes[number];
type Copy = (english: string, arabic: string) => string;
const allowedCodes = new Set<string>(codes);
const stages = new Set<string>(['terms', 'draft', 'initialize', 'read', 'upload', 'publish']);

/** Only stable, allowlisted values may be retained or displayed. Native HTTP
 * errors can contain bearer tokens, upload session URLs, and local file paths. */
export function sanitizeClipUploadError(error: unknown): { code: ClipUploadErrorCode; stage?: ClipUploadStage } {
  const failure = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; clipUploadStage?: unknown } : {};
  // Callable errors put their specific business reason in message, with a
  // general Firebase code (e.g. failed-precondition) alongside it.
  const reason = typeof failure.message === 'string' && allowedCodes.has(failure.message) ? failure.message
    : typeof failure.code === 'string' && allowedCodes.has(failure.code) ? failure.code : 'clip-upload-failed';
  const stage = typeof failure.clipUploadStage === 'string' && stages.has(failure.clipUploadStage)
    ? failure.clipUploadStage as ClipUploadStage : undefined;
  return { code: reason as ClipUploadErrorCode, ...(stage ? { stage } : {}) };
}

export function clipUploadErrorMessage(error: unknown, c: Copy, fallbackStage?: ClipUploadStage): string {
  const failure = sanitizeClipUploadError(error), stage = failure.stage ?? fallbackStage;
  switch (failure.code) {
    case 'clip-upload-cancelled': case 'storage/canceled': case 'functions/cancelled':
      return c('Upload stopped. The draft is kept for retry.', 'توقف الرفع. المسودة محفوظة لإعادة المحاولة.');
    case 'clip-session-changed': case 'clip-draft-owner-mismatch': case 'clips-account-changed':
      return c('Your account changed. Sign in to the account that owns this draft and try again.', 'تغيّر الحساب. سجّل الدخول بالحساب الذي أنشأ هذه المسودة وحاول مجددًا.');
    case 'sign-in-required': case 'storage/unauthenticated': case 'functions/unauthenticated':
    case 'auth/user-token-expired': case 'auth/id-token-expired': case 'auth/invalid-user-token':
      return c('Sign in again, then reopen this draft to publish.', 'سجّل الدخول مجددًا، ثم افتح هذه المسودة لنشرها.');
    case 'account-unavailable': case 'clips-account-suspended':
      return c('Publishing is unavailable for this account. Your draft is kept; contact support.', 'النشر غير متاح لهذا الحساب. المسودة محفوظة؛ تواصل مع الدعم.');
    case 'clip-group-membership-required':
      return c('You must be a member of the selected group. Choose another audience or rejoin the group.', 'يجب أن تكون عضوًا في المجموعة المحددة. اختر جمهورًا آخر أو انضم إلى المجموعة مجددًا.');
    case 'storage/unauthorized': case 'functions/permission-denied':
      return c('The upload was denied. Your draft is kept; contact support if this continues.', 'رُفضت صلاحية رفع المقطع. المسودة محفوظة؛ تواصل مع الدعم إذا استمرت المشكلة.');
    case 'clip-file-missing': case 'local-file-missing': case 'file/not-found':
      return c('The video file is no longer available on this device. Choose it again.', 'ملف الفيديو لم يعد متاحًا على هذا الجهاز. اختره مجددًا.');
    case 'clip-file-too-large':
      return c('This video exceeds the upload size limit. Choose a smaller file.', 'حجم الفيديو يتجاوز الحد المسموح للرفع. اختر ملفًا أصغر.');
    case 'clip-file-invalid': case 'clip-source-invalid': case 'storage/invalid-argument':
      return c('This video cannot be uploaded. Choose a supported MP4, MOV or WebM file.', 'تعذّر رفع هذا الفيديو. اختر ملف MP4 أو MOV أو WebM مدعومًا.');
    case 'storage/invalid-checksum':
      return c('The uploaded video could not be verified. Retry the saved draft.', 'تعذّر التحقق من سلامة الفيديو المرفوع. أعد المحاولة من المسودة المحفوظة.');
    case 'clip-trim-invalid': case 'clip-overlay-invalid': case 'clip-mute-invalid': case 'clip-options-invalid': case 'audience-invalid':
      return c('Check the video trim, text and audience before publishing again.', 'تحقق من نطاق قص الفيديو والنص والجمهور قبل إعادة النشر.');
    case 'clip-upload-daily-limit':
      return c('You have reached today’s upload limit. Your draft is kept; try again tomorrow.', 'بلغت الحد اليومي لرفع المقاطع. المسودة محفوظة؛ حاول مجددًا غدًا.');
    case 'clips-rate-limited': case 'functions/resource-exhausted':
      return c('Too many attempts. Keep this draft and try again in a minute.', 'المحاولات متقاربة جدًا. احتفظ بهذه المسودة وحاول مجددًا بعد دقيقة.');
    case 'storage/quota-exceeded':
      return c('Uploads are temporarily unavailable. Your draft is kept; contact support.', 'رفع المقاطع غير متاح مؤقتًا. المسودة محفوظة؛ تواصل مع الدعم.');
    case 'clips-terms-required': case 'clips-terms-version-changed':
      return c('The community terms changed. Read and accept the updated terms before publishing.', 'تغيّرت شروط المجتمع. اقرأ الشروط المحدّثة ووافق عليها قبل النشر.');
    case 'clips-disabled':
      return c('Publishing is currently disabled. Your draft is kept for later.', 'النشر معطّل حاليًا. المسودة محفوظة لنشرها لاحقًا.');
    case 'clip-draft-closed': case 'clip-cannot-publish': case 'clip-unavailable':
      return c('This clip cannot be published from this draft. Choose the video again to create a new draft.', 'تعذّر نشر المقطع من هذه المسودة. اختر الفيديو مجددًا لإنشاء مسودة جديدة.');
    case 'clip-drafts-unavailable':
      return c('Could not save the draft on this device. Check available storage and try again.', 'تعذّر حفظ المسودة على هذا الجهاز. تحقق من المساحة المتاحة وحاول مجددًا.');
    case 'storage/no-default-bucket': case 'storage/no-bucket': case 'storage/bucket-not-found': case 'storage/project-not-found':
      return c('The upload service is unavailable. Your draft is kept; contact support.', 'خدمة رفع المقاطع غير متاحة. المسودة محفوظة؛ تواصل مع الدعم.');
    case 'storage/retry-limit-exceeded': case 'functions/deadline-exceeded': case 'functions/unavailable': case 'auth/network-request-failed':
      if (stage !== 'publish') return c('The upload could not finish. Check your connection and retry this draft.', 'تعذّر إكمال الرفع. تحقق من الاتصال وأعد المحاولة من هذه المسودة.');
      break;
    case 'clip-upload-incomplete':
      return c('The video upload is incomplete. Retry this draft to upload it again.', 'رفع الفيديو غير مكتمل. أعد المحاولة من هذه المسودة لرفعه مجددًا.');
    case 'storage/object-not-found':
      return c('This upload session expired. Retry the saved draft to start a new upload.', 'انتهت جلسة الرفع. أعد المحاولة من المسودة المحفوظة لبدء رفع جديد.');
  }
  if (stage === 'publish') return c('Video upload completed, but publication was not confirmed. Retry this draft to check its status.', 'اكتمل رفع الفيديو، لكن لم يتأكد النشر. أعد المحاولة من هذه المسودة للتحقق من حالته.');
  if (stage === 'draft') return c('Could not save the draft on this device. Check available storage and try again.', 'تعذّر حفظ المسودة على هذا الجهاز. تحقق من المساحة المتاحة وحاول مجددًا.');
  const reference = stage === 'terms' ? 'CLIP-TERMS' : stage === 'initialize' ? 'CLIP-INIT' : stage === 'read' ? 'CLIP-FILE' : 'CLIP-UPLOAD';
  return c(`Could not complete this upload. Try the saved draft again. Reference: ${reference}.`, `تعذّر إكمال رفع المقطع. أعد المحاولة من المسودة المحفوظة. المرجع: ${reference}.`);
}
