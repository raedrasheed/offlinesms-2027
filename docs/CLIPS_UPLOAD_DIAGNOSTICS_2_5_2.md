# Clip upload diagnostics — 2.5.2 / build 33

## Purpose

The native uploader in 2.5.1 reports `storage/unauthorized` for any HTTP 403. The production Android upload still fails before `publishClip`. The previous log identifies the broad upload stage but discards the failed HTTP operation and server response category. This release adds diagnostic evidence; it does not claim to fix the production rejection.

On 2026-11-03, the production investigation verified the Storage service agent's unconditional roles, the active bucket rules, the default App Check service configuration, enabled billing, and the expected bucket string in the locally built APK. The two inspected clip reservations had an allowed status, matching source path, numeric 80 MiB limit, future timestamp expiry and existing publisher profiles without suspension/deletion flags. These checks do not establish which HTTP operation or authorization condition rejects the actual device request.

## Diagnostic contract

- Only failed HTTP responses emit `[clips-upload-http]` with the operation (`start`, `chunk`, `finalize` or `query`), HTTP status, existing Storage error code and a finite response category. A combined upload/finalize request is labelled `finalize`.
- Categories describe recognized server-response text; `permission-denied` does not distinguish Security Rules from IAM. Unknown responses remain unknown. No raw body, response headers, session URL, bearer token, user identifier or file path is logged.
- Successful responses are not read for diagnostics. A failed control response has a short body-read timeout, and known oversized responses are skipped. Classification examines a bounded prefix. React Native fetch does not provide a reliable streaming body reader, so this is not a guarantee that the network layer never buffers a larger response.
- Diagnostic collection must not replace the original HTTP failure, add a retry for HTTP 403, or discard a saved draft. Upload authorization, rules, backend functions, dependencies and signing configuration are unchanged.

## Device verification

Local validation: all 152 mobile clip tests across 16 files pass, including 32 native transport tests and 13 response classifier tests. Mobile TypeScript checking passes. An independent review found no blocking issues in logging safety, error preservation or cancellation behavior. These checks do not substitute for the pending real-device reproduction.

Build an APK from this revision with the existing production configuration and the signing certificate compatible with the installed app. Retry the existing saved draft once, then collect only the diagnostic lines in Windows PowerShell:

```powershell
adb logcat -d -v time "ReactNativeJS:W" "*:S" | Select-String -SimpleMatch "[clips-upload" | Select-Object -Last 20
```

The broader prefix includes both `[clips-upload-http]` and the existing `[clips-upload]` summary. Record whether progress stayed at zero or advanced. Do not uninstall the app to work around a signing mismatch; preserve its local drafts. No Firebase redeployment is needed for this diagnostic change. Keep store rollout pending until a real-device upload, processing and playback succeed.

## Sources

- [Firebase Storage error codes](https://firebase.google.com/docs/storage/web/handle-errors)
- [Storage billing errors, including HTTP 403](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)
- [Cloud Storage JSON API error responses](https://docs.cloud.google.com/storage/docs/json_api/v1/status-codes)
- [Android Logcat filtering](https://developer.android.com/tools/logcat)
