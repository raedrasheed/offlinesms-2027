# OfflineSMS-Business — Android SMS Relay (private)

A **private, business-only** native Android app that turns an approved merchant's
phone + SIM into a private SMS gateway for the OfflineSMS backend. **Not** a
consumer app; **never** published on the public Play Store.

- **Outbound SMS only** (no inbound, no `READ_SMS`/`RECEIVE_SMS`, no contacts).
- **Useless until enrolled:** does nothing until a business owner/admin links it
  from the dashboard via a one-time pairing code.
- **Separate** from `apps/mobile`; `applicationId = app.offlinesms.business`.

## Status — Phase 2 (MVP)
Implemented: enrollment (pairing code → `enrollRelayDevice` → custom-token
sign-in), encrypted credential storage, Room queue, foreground relay service
(claim → send → heartbeat), `SmsManager` send engine (multipart/Unicode),
sent/delivered PendingIntent → durable report (WorkManager retry/offline sync),
FCM wake, pause/resume + revoke UI, body-free local logs.

> ⚠️ Not yet built/run on a device in this environment. Requires Android Studio,
> a `google-services.json`, and a real phone with a SIM. See runbook below.

## Prerequisites
1. **Firebase console** (project `offlinesms-prod-2027`):
   - Register an Android app with package `app.offlinesms.business`.
   - Download its **`google-services.json`** → place at `apps/mobile-relay/app/google-services.json`.
   - Ensure Cloud Functions (`relay*`) are deployed and Cloud Messaging is enabled.
2. The enrolling dashboard user must have claims `role: organization_admin` (+ an
   `organizationId`) or `super_admin`.

## Build & run (device)
```
cd apps/mobile-relay
gradle wrapper                 # first time only
./gradlew :app:assembleDebug
# install the APK on a phone with a SIM, then grant SMS + notification perms.
```

## End-to-end test (Phase 2 acceptance)
1. **Create a pairing code** (until the Phase 4 dashboard UI exists):
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
   BUSINESS_ID=<organizationId> npx tsx scripts/relayPairingCode.ts
   ```
2. **Enroll:** open the app, enter the code → device signs in and appears in
   `relayDevices` (status `active`); heartbeats begin (online within ~60s).
3. **Queue a test job:** create a `relayJobs/{batchId:recipientUid}` doc (status
   `queued`, `businessId`, `phoneE164`, `messageBody`) — or call the dispatcher
   from the functions shell. The device claims it on its next tick / FCM wake.
4. **Send:** the device sends one real SMS via the SIM.
5. **Report:** backend receives `sent` (and `delivered` if the carrier returns a
   report) on the job + mirrored to the batch recipient `smsStatus`.

## Distribution
Private only — signed APK/AAB via Firebase App Distribution / dashboard-gated
download / MDM. Do **not** create a public Play listing (`SEND_SMS` is restricted).

## Permissions (final set — do not add others)
`SEND_SMS`, `READ_PHONE_STATE`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_DATA_SYNC`, `RECEIVE_BOOT_COMPLETED`, `INTERNET`.

## Known Phase 2 limitations (hardening = Phase 3)
- Lost FirebaseAuth session (rare) requires re-enrollment (custom tokens are
  one-time/short-lived); a refresh/re-pair flow is Phase 3.
- SIM selection uses the default SIM (dual-SIM `subscriptionId` routing = Phase 3/5).
- Lease-expiry requeue, OEM battery-exemption prompts, and crash reporting = Phase 3.
- Backend relay is **not** wired into `escalateSms`; HTTP provider stays default.
