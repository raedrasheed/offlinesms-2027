import { describe, expect, it } from 'vitest';
import { classifyClipUploadHttpFailure } from '../src/lib/clipStorageHttpDiagnostics';

const body = (error: Record<string, unknown>) => JSON.stringify({ error });
const errorInfo = (reason: string) => ({ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', domain: 'googleapis.com', reason });

describe('safe clip Storage HTTP diagnostics', () => {
  it.each([
    ['Permission denied.', 'permission-denied'],
    ['Permission denied. No WRITE permission.', 'permission-denied'],
    ['Firebase App Check token is invalid.', 'app-check'],
    ['Missing Firebase App Check token.', 'app-check'],
    ['App Check verification failed.', 'app-check'],
    ['The billing account for the owning project is disabled in state delinquent.', 'billing'],
    ['This API method requires billing to be enabled. Please enable billing on your project.', 'billing'],
    ['Cloud Storage API has not been used in project 123 before or it is disabled. Enable it then retry.', 'service-disabled'],
  ])('classifies an explicit error message without returning it: %s', (message, expected) => {
    expect(classifyClipUploadHttpFailure(body({ code: 403, message }), 'application/json')).toBe(expected);
  });

  it('recognizes documented structured reasons and prioritizes specific reasons over permission status', () => {
    expect(classifyClipUploadHttpFailure(body({ status: 'PERMISSION_DENIED', details: [errorInfo('BILLING_DISABLED')] }))).toBe('billing');
    expect(classifyClipUploadHttpFailure(body({ status: 'PERMISSION_DENIED', details: [errorInfo('SERVICE_DISABLED')] }))).toBe('service-disabled');
    expect(classifyClipUploadHttpFailure(body({ status: 'PERMISSION_DENIED', message: 'Firebase App Check token is invalid.' }))).toBe('app-check');
    expect(classifyClipUploadHttpFailure(body({ errors: [{ reason: 'insufficientPermissions' }] }))).toBe('permission-denied');
    expect(classifyClipUploadHttpFailure(body({ errors: [{ reason: 'forbidden', message: 'Forbidden' }] }))).toBe('permission-denied');
    expect(classifyClipUploadHttpFailure(body({ status: 'PERMISSION_DENIED' }))).toBe('permission-denied');
  });

  it('does not infer billing, disabled services or Rules from ambiguous errors', () => {
    for (const reason of ['accountDisabled', 'UserProjectAccountProblem', 'accessNotConfigured', 'unknown-reason'])
      expect(classifyClipUploadHttpFailure(body({ code: 403, errors: [{ reason }] }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure(body({ code: 403 }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure(body({ message: 'Your billing account is not disabled.' }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure(body({ message: 'App Check token is valid.' }))).toBe('unknown');
  });

  it('recognizes HTML responses without extracting the page or treating its words as backend reasons', () => {
    expect(classifyClipUploadHttpFailure('<!DOCTYPE html><html>permission denied</html>')).toBe('html-response');
    expect(classifyClipUploadHttpFailure('\ufeff \n<html lang="en">billing disabled</html>')).toBe('html-response');
    expect(classifyClipUploadHttpFailure('proxy response', 'Text/HTML; charset=UTF-8')).toBe('html-response');
    expect(classifyClipUploadHttpFailure('<h1>error</h1>', 'application/xhtml+xml')).toBe('html-response');
    expect(classifyClipUploadHttpFailure('unrecognized plain text', 'text/plain')).toBe('unknown');
  });

  it('distinguishes unavailable bodies and bounds parsing to the first 16 KiB', () => {
    expect(classifyClipUploadHttpFailure(undefined, 'application/json')).toBe('unavailable');
    expect(classifyClipUploadHttpFailure('')).toBe('unknown');
    expect(classifyClipUploadHttpFailure(' '.repeat(16 * 1024) + body({ message: 'Permission denied.' }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure(body({ padding: 'x'.repeat(16 * 1024), message: 'Permission denied.' }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure('{invalid json')).toBe('unknown');
    expect(classifyClipUploadHttpFailure('null')).toBe('unknown');
    expect(classifyClipUploadHttpFailure('[]')).toBe('unknown');
  });

  it('ignores arbitrary nested payloads and returns only a fixed enum for sensitive or malicious content', () => {
    const secret = 'https://host/upload?upload_id=secret-token\nBearer abc.def.ghi /private/video.mp4 user@example.com';
    expect(classifyClipUploadHttpFailure(body({ code: 403, message: secret, details: [{ reason: 'BILLING_DISABLED' }] }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure(body({ message: secret, metadata: { message: 'Permission denied.' } }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure(body({ message: `Permission denied. ${secret}` }))).toBe('permission-denied');
    expect(classifyClipUploadHttpFailure(body({ details: [{ ...errorInfo('BILLING_DISABLED'), domain: 'untrusted.example' }] }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure(body({ errors: [{ reason: 'BILLING_DISABLED', domain: 'untrusted.example' }] }))).toBe('unknown');
    expect(classifyClipUploadHttpFailure(body({ errors: [null, [], 'forbidden', { reason: secret }], details: [null, false] }))).toBe('unknown');
  });
});
