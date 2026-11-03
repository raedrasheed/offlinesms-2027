/** Shared by the explicit first-interaction prompt and the publishing checkbox.
 * A server terms-version change always requires a fresh, explicit decision. */
export const CLIPS_COMMUNITY_TERMS = {
  en: 'Publish only videos, images and text you own or have permission to share. Keep posts, videos and comments respectful. Do not post harassment, sexual content, graphic violence, illegal material, or other people’s private information. Reports are reviewed and violating content or accounts may be removed. Private content keeps its audience restrictions when shared.',
  ar: 'انشر فيديوهات وصورًا ونصوصًا تملكها أو لديك إذن بمشاركتها. حافظ على الاحترام في المنشورات والفيديوهات والتعليقات. يُمنع نشر الإساءة أو المحتوى الجنسي أو العنف الصادم أو المحتوى غير القانوني أو معلومات الآخرين الخاصة. تُراجع البلاغات وقد يُحذف المحتوى أو تُقيّد الحسابات المخالفة. تبقى صلاحيات المحتوى الخاص محفوظة عند المشاركة.',
};

type TermsState = {config: {enabled: boolean; termsVersion: string}; termsAccepted: boolean};
type Dependencies = {
  getUid: () => string | undefined;
  loadTerms: () => Promise<TermsState>;
  acceptTerms: (version: string, expectedUid: string) => Promise<unknown>;
  confirm: (version: string) => Promise<boolean>;
  watchAccount?: (onChange: (uid: string | undefined) => void) => () => void;
};
type FlowCode = 'clips-terms-cancelled' | 'clips-account-changed' | 'clips-terms-version-changed' | 'clips-disabled';
export class ClipTermsFlowError extends Error {
  readonly code: FlowCode;
  constructor(code: FlowCode) { super(code); this.name = 'ClipTermsFlowError'; this.code = code; }
}
export function isClipTermsCancellation(error: unknown): boolean {
  const value = error as {code?: string; message?: string} | null;
  return value?.code === 'clips-terms-cancelled' || value?.code === 'clips-account-changed' ||
    (value?.code === 'functions/failed-precondition' && value.message === 'clips-account-changed');
}
export function isClipTermsRequired(error: unknown): boolean {
  const value = error as {code?: string; message?: string} | null;
  return (value?.code === 'functions/failed-precondition' || value?.code === 'failed-precondition') && value.message === 'clips-terms-required';
}

/** Retry only the rejected operation, once, after version-bound acceptance.
 * A terms-required server error occurs before any mutation. We never replay
 * an ambiguous network error, so comment/share client IDs retain their meaning. */
export function createClipTermsGate(deps: Dependencies) {
  const flights = new Map<string, Promise<void>>();
  function assertAccount(uid: string) {
    if (deps.getUid() !== uid) throw new ClipTermsFlowError('clips-account-changed');
  }
  function ensure(uid: string): Promise<void> {
    assertAccount(uid);
    const existing = flights.get(uid);
    if (existing) return existing;
    const flight = (async () => {
      let changed = false;
      const stop = deps.watchAccount?.(next => { if (next !== uid) changed = true; });
      const check = () => { assertAccount(uid); if (changed) throw new ClipTermsFlowError('clips-account-changed'); };
      try {
        const current = await deps.loadTerms(); check();
        if (!current.config.enabled) throw new ClipTermsFlowError('clips-disabled');
        if (current.termsAccepted) return;
        const version = current.config.termsVersion;
        const accepted = await deps.confirm(version); check();
        if (!accepted) throw new ClipTermsFlowError('clips-terms-cancelled');
        // A version can change while the user reads the dialog. Never accept a
        // version whose prompt they have not just seen, even if the text matches.
        const latest = await deps.loadTerms(); check();
        if (!latest.config.enabled) throw new ClipTermsFlowError('clips-disabled');
        if (latest.config.termsVersion !== version) throw new ClipTermsFlowError('clips-terms-version-changed');
        if (!latest.termsAccepted) { await deps.acceptTerms(version,uid); check(); }
      } finally { stop?.(); }
    })();
    flights.set(uid, flight);
    void flight.then(() => { if (flights.get(uid) === flight) flights.delete(uid); }, () => { if (flights.get(uid) === flight) flights.delete(uid); });
    return flight;
  }
  return async function withClipTerms<R>(operation: () => Promise<R>): Promise<R> {
    const uid = deps.getUid();
    try { return await operation(); }
    catch (error) {
      if (!isClipTermsRequired(error)) throw error;
      if (!uid) throw new ClipTermsFlowError('clips-account-changed');
      assertAccount(uid);
      await ensure(uid);
      assertAccount(uid);
      return operation();
    }
  };
}
