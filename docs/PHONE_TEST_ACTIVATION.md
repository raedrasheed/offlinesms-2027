# Phone registration and the combined test build

Updated 2026-10-09. The owner requested phone registration and completion of the
remaining features for testing, using the already-approved production project
`offlinesms-prod-2027`. This supersedes the earlier instruction to keep the
feature suspended. **Authorization is recorded; activation has not completed.**

## Current delivery

- `offlinesms-test-updated`: notification fixes, conversation-opening changes,
  full searchable emoji reactions, stickers, single/multiple-choice polls and
  durable offline poll closing. Install over the existing test app.
- `offlinesms-relay-test`: private Android relay 0.2.0, package
  `app.offlinesms.business`, configured for the same Firebase project. It is
  built only when the existing CI config contains this registered Android app.
  It sends nothing until enrolled and enabled by the backend. The unit-test
  build continues to use a placeholder project.
- The relay uses a stable **test** signing key. Check `signing-cert.txt` against
  the installed relay before updating. If Android refuses a signature mismatch,
  stop: do not uninstall a working relay with pending jobs/reports. An upgrade
  needs the existing signing key or a separately planned re-enrollment.

## Backend deployment still needed

The Firebase console session authenticated successfully as the project owner's
account. Google Cloud Console and standalone Cloud Shell were unavailable from
this session, and no authenticated Firebase/gcloud CLI session was present.
No functions or runtime flags were changed during this attempt.

From an authorized deployment environment, check out the exact reviewed PR #29
commit and install its dependencies (`npm ci`). For stickers and polls, the
scoped deployment is:

```sh
npx firebase deploy --project offlinesms-prod-2027 --only functions:sendTextMessage,functions:votePoll,functions:closePoll,functions:deleteMessage,functions:onMessageCreate,functions:onMessageCreateNotify
```

This command changes no SMS policy, phone function, rule or index. Verify the
deployed revision and smoke-test creation, voting and closing with the two test
accounts before marking those device checks passed.

## Phone activation prerequisites

The protected phone-registration and add-phone flows already exist. They use
the private SMS relay, not Firebase's built-in Phone provider. Keep that old
provider disabled and retain the existing `PHONE_HASH_PEPPER` secret.

1. Read the **current** `smsConfig/otp` and relay state. The last recorded state
   (§12.5 of `PHONE_LINKING_SECURITY.md`) was stopped; the two physical relays
   were 0.1.0, paused/revoked and without fresh heartbeats. This is historical
   evidence, not a fresh fleet read from this attempt.
2. Install relay 0.2.0 on the sending phone with its working SIM. Verify its
   enrollment, active status, `send-auth-v1` capability, correct business and
   country routing, positive capacity and fresh heartbeat. Do not substitute
   a synthetic device record or change its reported version to pass this check.
3. Review the deployment manifest and outstanding real-device checks in
   `PHONE_LINKING_SECURITY.md` §12. Deploy with `PHONE_AUTH_ENABLED=true` and
   `PHONE_LINK_ENABLED=true` on the corresponding phone handlers **and** relay
   policy consumers; setting Firestore flags alone is insufficient. Preserve
   attestation, proof-of-work, destination/source limits and existing secrets.
4. With a ready relay and a monitored test window, update the master/purpose
   policy together: `enabled:true`, `emergencyStop:false`, `signin.enabled:true`,
   `link.enabled:true`, correct existing sender business and a new policy
   generation. Start with bounded budgets. These switches affect production
   callers; the test APK is not an isolated backend.
5. On the owner's test number, request a code, verify actual SIM delivery, sign
   in, then test adding a number to the email account. Confirm resend cooldown,
   incorrect-code refusal and emergency stop. Record observed results only.

No SMS was sent by this attempt. A successful APK build does not establish
relay readiness or phone-registration availability. Physical-device performance
also still needs comparison using `scripts/device/perf-capture.sh`.
