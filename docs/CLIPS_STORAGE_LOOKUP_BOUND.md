# Bound clip upload authorization to two Firestore reads

## Production evidence

Android 2.5.2 reported `operation=finalize httpStatus=403 code=storage/unauthorized responseCategory=permission-denied` at 22:37:10 on 2026-11-03 (Asia/Hebron). Cloud Monitoring showed one Storage Rules `CREATE / STABLE / ERROR` evaluation in the matching 20:36:52–20:37:52 UTC interval. This correlates the upload failure with a Rules evaluation error, but does not identify the failing expression.

Hosted `projects:test` probes subsequently passed for empty metadata `size()`, a missing optional profile flag read with `Map.get()`, and `metadata.keys().hasOnly([])`. Those synthetic cases do not exercise the live Firestore lookups.

## Change

The previous valid-upload predicate invoked `firestore.get()` twice for the publisher profile and five times for the clip reservation. Storage Rules permit at most two Firestore access calls per request; repeated calls to the same document may be cached. The rule therefore relied on caching to remain within the documented limit.

The source-upload helper now binds the publisher and reservation once each using `let`. Authentication and non-deletion guards remain outside the helper. Owner, reservation status, source path, lease expiry, size, MIME, optional suspension/deletion flags, empty custom metadata, and private-read restrictions retain their prior meaning. Missing documents still deny uploads.

This removes reliance on repeated-read caching. The observed production error has not yet been proven to be call-limit exhaustion, so successful real-device finalization is still required before declaring the incident resolved.

## Validation

All 185 Firestore and Storage rules tests across 22 files pass locally with the emulators. Native resumable tests include successful finalization with omitted optional publisher flags and denial when the publisher profile disappears after session creation. Existing cases retain coverage of ownership, reservation status/path/expiry, suspension/deletion, size/MIME/custom metadata, and private reads. Independent review found no blocking issues. Emulator success does not establish that the production evaluation error is resolved.

## Deployment and verification

Deploy only Storage rules to `offlinesms-prod-2027`. Use the installed 2.5.2 diagnostic app to retry the saved draft once, then check finalization, `publishClip`, processing, review and playback. If the same error remains, correlate the new attempt with Storage Rules metrics and investigate the live cross-service lookup failure. Do not broaden upload authorization as a diagnostic shortcut.

## References

- [Storage Rules access-call limit and caching](https://firebase.google.com/docs/rules/rules-behavior#security_rules_limits_1)
- [Storage Rules functions and local variables](https://firebase.google.com/docs/storage/security/rules-conditions#custom_functions)
- [Rules evaluation metrics](https://docs.cloud.google.com/monitoring/api/metrics_gcp_d_h#firebasestorage)
- [Hosted Rules test API](https://firebase.google.com/docs/reference/rules/rest/v1/projects/test)
