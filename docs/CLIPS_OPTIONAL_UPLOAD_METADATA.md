# Guard optional metadata during clip uploads

## Evidence

After the two-document lookup change, Android 2.5.2 still reported a 403 at clip upload finalization. A chat image uploaded successfully from the same device/account. A hosted Rules test using the active Storage source and substituted reservation/profile snapshots allowed `metadata: {}` but failed with an undefined-property error when metadata was omitted and a null-value error when metadata was `null`. A nonempty metadata map was correctly denied.

These synthetic tests identify a rule evaluation bug. They do not establish the metadata shape of the failing production request, and the substituted snapshots do not test live cross-service lookups. Real-device finalization remains the confirmation step.

## Change

The clip-source rule accepts an absent metadata field, `null`, or an empty map before invoking map methods. It still rejects nonempty maps and malformed metadata values. All owner, publisher, reservation, path, expiry, size and MIME checks remain in place, as do the two Firestore reads and the denial of direct source/output reads. Client custom metadata, including caller-supplied download-token keys presented to the rule, remains forbidden. Server-side token stripping is unchanged.

## Validation

Native resumable tests cover omitted, empty and null wire metadata. Because the Storage emulator normalizes these wire representations, an additional test feeds raw shapes through test-only auth claims into the actual production helper. It checks missing/null/empty-map acceptance, nonempty/scalar/list denial, and rejection of another account. The test retains the surrounding production authorization checks and restores the original rules afterward; no probe path or auth-claim bypass is shipped.

All 189 rules tests across 22 files pass locally, including the targeted 20-test clip subset. Independent review found no blocking issues. Validation command:

```sh
firebase emulators:exec --project demo-offlinesms --only firestore,storage "npm run test:rules"
```

## Deployment

Deploy only Storage rules to `offlinesms-prod-2027`. The installed diagnostic app can retry the saved draft without an APK rebuild. Allow time for rule propagation, retry once, and verify upload finalization, publication/processing, moderation and playback. Do not declare the incident resolved based on synthetic tests alone.

## References

- [Storage Rules map membership, missing fields and errors](https://firebase.google.com/docs/reference/security/storage)
- [Hosted Rules test API](https://firebase.google.com/docs/reference/rules/rest/v1/projects/test)
- [Deploying and propagating rules](https://firebase.google.com/docs/rules/manage-deploy)
