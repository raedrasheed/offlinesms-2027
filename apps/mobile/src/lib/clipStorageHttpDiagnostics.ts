export type ClipUploadHttpFailureCategory =
  | 'billing' | 'app-check' | 'permission-denied' | 'service-disabled'
  | 'html-response' | 'unknown' | 'unavailable';

const MAX_BODY_LENGTH = 16 * 1024;
const MAX_ITEMS = 16;
type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
const string = (value: unknown): string => typeof value === 'string' ? value : '';

/** Describes only what an error response explicitly reports, not its root cause.
 * In particular, permission-denied does not distinguish Storage Rules from IAM.
 * Never return response text, paths, tokens, IDs, or arbitrary server reasons.
 *
 * JSON error shapes / reasons:
 * https://cloud.google.com/storage/docs/json_api/v1/status-codes
 * https://cloud.google.com/php/docs/reference/common-protos/latest/Api.ErrorReason
 */
export function classifyClipUploadHttpFailure(body: string | undefined, contentType?: string): ClipUploadHttpFailureCategory {
  if (typeof body !== 'string') return 'unavailable';
  const text = body.slice(0, MAX_BODY_LENGTH).trim();
  const mime = (contentType ?? '').slice(0, 256).split(';', 1)[0].trim().toLowerCase();
  if (mime === 'text/html' || mime === 'application/xhtml+xml' || /^<(?:!doctype\s+html\b|html(?:\s|>))/i.test(text))
    return 'html-response';

  let error: JsonObject | null;
  try { error = object(object(JSON.parse(text))?.error); }
  catch { return 'unknown'; }
  if (!error) return 'unknown';

  const messages = [string(error.message)];
  const reasons: string[] = [];
  const infrastructureReasons: string[] = [];
  if (Array.isArray(error.errors)) {
    for (const entry of error.errors.slice(0, MAX_ITEMS)) {
      const detail = object(entry);
      if (detail) { reasons.push(string(detail.reason)); messages.push(string(detail.message)); }
    }
  }
  if (Array.isArray(error.details)) {
    for (const entry of error.details.slice(0, MAX_ITEMS)) {
      const detail = object(entry);
      if (detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && detail.domain === 'googleapis.com')
        infrastructureReasons.push(string(detail.reason));
    }
  }

  // These exact ErrorInfo reasons are documented. accountDisabled and
  // UserProjectAccountProblem alone are intentionally NOT called billing:
  // Cloud Storage documents billing as only one possible cause for them.
  if (infrastructureReasons.includes('BILLING_DISABLED') || messages.some(message =>
    /\bbilling account(?: for (?:the )?(?:owning )?project)? (?:is|has been) (?:disabled|closed|delinquent)\b/i.test(message)
    || /\bbilling (?:is|has been) (?:disabled|not enabled)\b/i.test(message)
    || /\brequires billing to be enabled\b|\bplease enable billing\b/i.test(message))) return 'billing';
  if (messages.some(message =>
    /\bapp[ -]?check token (?:is |was )?(?:invalid|missing|expired|rejected|required)\b/i.test(message)
    || /\bapp[ -]?check token (?:has expired|is not valid)\b/i.test(message)
    || /\b(?:missing|invalid|expired) (?:firebase )?app[ -]?check token\b/i.test(message)
    || /\bapp[ -]?check (?:verification|validation|attestation) (?:has )?failed\b/i.test(message))) return 'app-check';
  if (infrastructureReasons.includes('SERVICE_DISABLED') || messages.some(message =>
    /\b(?:api|service) has not been used in project .{1,120} before or it is disabled\b/i.test(message)
    || /\b(?:api|service) (?:is|has been) disabled\b/i.test(message))) return 'service-disabled';
  if (error.status === 'PERMISSION_DENIED' || reasons.some(reason => reason === 'forbidden' || reason === 'insufficientPermissions')
    || messages.some(message => /^permission denied(?:[.:]|$)/i.test(message.trim())
      || /^forbidden[.!]?$/i.test(message.trim())
      || /^missing or insufficient permissions[.!]?$/i.test(message.trim()))) return 'permission-denied';
  return 'unknown';
}
