# OfflineSMS-Business — Android SMS Relay (private)

A **private, business-only** native Android app that turns an approved merchant's
phone + SIM into a private SMS gateway for the OfflineSMS backend. It is **not** a
consumer app and is **never** published on the public Play Store.

- **Outbound SMS only** (no inbound, no `READ_SMS`/`RECEIVE_SMS`, no contacts).
- **Useless until enrolled:** the device does nothing until a business owner/admin
  links it from the OfflineSMS dashboard via a one-time pairing code.
- **Separate** from the consumer app (`apps/mobile`); different `applicationId`
  (`app.offlinesms.business`).

## Status — Phase 0 scaffold
This folder currently contains only project scaffolding (Gradle config, manifest
with the agreed permission set, placeholders). The relay engine, foreground
service, Room queue, enrollment, and reporting are implemented in **Phase 2**
(see the production plan / `Implementation Phases`).

## Build (once Phase 2 lands)
```
cd apps/mobile-relay
gradle wrapper            # generate the wrapper if not present
./gradlew :app:assembleDebug
```

## Distribution
Private only — signed APK/AAB via Firebase App Distribution / dashboard-gated
download / MDM. Do **not** create a public Play Store listing (`SEND_SMS` is a
restricted permission; a non-default-SMS-handler app would be rejected).

## Permissions (final set — do not add others)
`SEND_SMS`, `READ_PHONE_STATE`, `POST_NOTIFICATIONS`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_DATA_SYNC`, `RECEIVE_BOOT_COMPLETED`, `INTERNET`.

## Backend contract
Implemented in `functions/src/sms/` (Phase 1): `createRelayPairingCode`,
`enrollRelayDevice`, `claimRelayJobs`, `reportRelayDelivery`, `relayHeartbeat`,
`revokeRelayDevice`, and the `relayDispatcher`. Shared TS types live in
`packages/shared/relayTypes.ts`; this app re-declares them as Kotlin data classes.
</content>
