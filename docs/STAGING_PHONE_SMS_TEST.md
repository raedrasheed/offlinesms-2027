# Staging: pair a relay phone and test phone sign-in with real SMS

This test runs on the staging project **`offlinesms-staging-2027` only**. Nothing here
deploys to or changes `offlinesms-prod-2027`, and the production verification-SMS
suspension stays as it is.

- `.firebaserc` defaults to `offlinesms-prod-2027`, so every CLI command below passes
  `--project offlinesms-staging-2027`.
- Before each Firebase console step, check that the project picker shows
  `offlinesms-staging-2027`.

The test sends at most **three** real verification SMS, all to numbers you control.
The budgets in step 1 cap anything unexpected at 5 per hour and 10 per day.

## Emergency stop (keep this open during the test)

| Stop | How | Effect |
|---|---|---|
| **Policy (primary)** | Firestore `smsConfig/otp`: set `emergencyStop` to `true` and raise `policyVersion` by 1. | New code requests fail with `service-paused`, and the app shows no phone countries. Queued jobs are cancelled when the relay tries to claim them. A job already claimed is refused at `authorizeRelaySend`. The `onOtpPolicyWritten` trigger also sweeps queued jobs. |
| **Relay device** | Firestore `relayDevices/<id>`: set `status` to `"paused"`. | The device claims nothing. Heartbeats do not undo a pause (`functions/src/sms/relayDevices.ts:181`). |
| **Physical** | Turn on airplane mode on the relay phone, or force-stop the relay app. | Nothing leaves the SIM. |

Missing or non-boolean values count as stopped: sending needs `emergencyStop` to be
exactly `false` (`functions/src/verification/policy.ts:89`).

## What you need

**Builds**
- **Relay:** run 38120895784 (commit 925b812), artifact `offlinesms-relay-test`. Its
  certificate SHA-256 must be the stable test key
  `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- **User app:** run 38118008600 (commit dc76907), artifact `offlinesms-test-updated`.

**Phone A (relay)**
- A SIM that can send SMS.
- It must **not** have the production relay installed, because it is the same package,
  `app.offlinesms.business`.
- If the dc76907 staging relay (certificate `6ade225e…`) is installed, uninstall it
  first. Its signature differs, so it cannot be updated in place.

**Phone B (user app)**
- First uninstall any production-backend test app. It is the same package,
  `app.offlinesms.mobile.test`.
- You need a staging account that signs in with email and has a verified address.

**Numbers**
- The server accepts only numbers whose national part starts with **59** or **56**
  (`functions/src/auth/otpLogic.ts:21`). Any other number is refused with
  `number-not-supported`.
- The relay serves only the countries chosen when it is paired. This runbook uses
  **PS** (+970). If the SIMs are from another country, use that country's ISO code.
- **Number B** is phone B's SIM.
- **Optional:** phone A's own number, for a new-account sign-up (step 5.3).

**Already in place on staging**
- The `PHONE_HASH_PEPPER` secret, from the `EMAIL_CHANGE_VERIFICATION.md` §1.1 setup.
  Confirm it with `gcloud secrets describe PHONE_HASH_PEPPER --project offlinesms-staging-2027`.
  Without it, the phone calls fail with `service-paused`.
- Custom-token signing. Relay enrollment and phone sign-in use `createCustomToken`, the
  same call as the email-code sign-in that already passed on staging.

**Not covered here**
- App Check and attestation: `signin.attestation` defaults to off, so the debug-signed
  test APK is accepted.
- SMS auto-read: `androidAppHash` is not set, so type each code by hand.
- Anything in production.

## 1. Write a stopped policy with small limits

In the Firestore console (staging), create or edit the document `smsConfig/otp`. Use
Firestore types: booleans, numbers, maps and arrays, not strings. Leave out
`businessId`, `attestation`, `review` and `androidAppHash`.

```
enabled:        false
emergencyStop:  true
policyVersion:  1            (or the current value + 1)
shared:  { perHour: 5, perDay: 10 }
signin:  { enabled: false,
           limits: { globalPerHour: 5, globalPerDay: 10,
                     sourcePerHour: 5, sourcePerDay: 10, sourceDistinctDestinationsPerDay: 2,
                     installPerDay: 4, installDistinctDestinationsPerDay: 2,
                     destinationPerHour: 3, destinationPerDay: 4, sessionMaxCodes: 2 } }
link:    { enabled: false,
           limits: { globalPerHour: 5, globalPerDay: 10, sourcePerHour: 5, sourcePerDay: 10,
                     accountPerHour: 2, accountPerDay: 3,
                     destinationPerHour: 3, destinationPerDay: 4 } }
```

- Limits you leave out keep their defaults.
- A value outside its bounds is clamped to them (`functions/src/phoneAuth/config.ts:53-103`,
  `functions/src/phoneLink/config.ts:49-86`).
- A value of `0` closes that scope.
- With such small hourly budgets, the proof-of-work difficulty rises after a few
  requests: +2 bits at 50 % of the hourly budget, +4 at 90 %. A slower "preparing"
  step on the phone is expected.

## 2. Turn on the phone purposes in staging functions

Sending stays off, because the policy from step 1 is stopped.

1. Staging runs the functions from 847ddf0. They are identical at 925b812:
   `git diff 847ddf0 925b812 -- functions firestore.rules firestore.indexes.json` is empty.
2. Add two lines to your existing `functions/.env.offlinesms-staging-2027` from
   `EMAIL_CHANGE_VERIFICATION.md` §2, and keep its current lines:

   ```
   PHONE_AUTH_ENABLED=true
   PHONE_LINK_ENABLED=true
   ```

3. Deploy all functions to staging:

   ```sh
   npx firebase deploy --project offlinesms-staging-2027 --only functions
   ```

   The flags must reach **every** function, not only the phone ones. The relay functions
   check them too: `claimRelayJobs`, `authorizeRelaySend` and the sweep, through
   `verificationJobStillValid` (`functions/src/verification/policy.ts:125-136`).
4. Check: the phone sign-in screen on phone B still lists **no** countries.

## 3. Pair the relay (phone A)

1. Install the relay APK.
   - Grant SMS, phone and notification permissions.
   - Exempt the app from battery optimization.
2. In the Firestore console (staging), create `relayPairingCodes/<CODE>`.
   - `<CODE>` is 8 characters you pick at random from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`.
   - The code is single-use and expires after 15 minutes.

   ```
   code:                "<CODE>"              (string, same as the document id)
   businessId:          "staging-otp-relay"   (string)
   createdByUid:        "console:owner"       (string)
   label:               "staging relay"       (string)
   used:                false                 (boolean)
   allowedCountryCodes: ["PS"]                (array of strings)
   expiresAt:           now + 15 minutes      (timestamp)
   ```

   This is the document that `createRelayPairingCode` writes
   (`functions/src/sms/relayDevices.ts:24-61`). `scripts/relayPairingCode.ts` writes the
   same document but leaves out the countries, and the device then enrolls with routing
   blocked.
3. In the relay app, enter `<CODE>` and the label `staging relay`, then tap **Link device**.
4. Check in the console:
   - `relayPairingCodes/<CODE>` has `used: true`.
   - The new `relayDevices/<id>` has:
     - `businessId: "staging-otp-relay"`
     - `status: "active"`
     - `appVersion: "0.2.0"`
     - `allowedCountryCodes: ["PS"]`
     - `countryRoutingEnabled: true`
     - a `lastHeartbeatAt` less than 90 seconds old, refreshed about every 60 seconds.
5. On that device document, set `caps` to `{ maxPerMinute: 1, maxPerHour: 5, maxPerDay: 10 }`.
   - The defaults are 6, 100 and 500 per minute, hour and day.
   - Every job the device claims counts against these caps, verification codes included
     (`functions/src/sms/relayJobs.ts:161-165`).

## 4. Open the test window

Make **one** edit to `smsConfig/otp`:

```
businessId:      "staging-otp-relay"
enabled:         true
emergencyStop:   false
signin.enabled:  true
link.enabled:    true
policyVersion:   previous + 1
```

- Sending needs the env flag, `enabled`, `emergencyStop: false`, `businessId` and the
  purpose's `enabled` all at once (`functions/src/verification/policy.ts:106-112`).
- Check: reopen the phone screen on phone B. It now offers Palestine. The app offers only
  countries that a live relay serves.

## 5. Tests (at most 3 SMS)

Follow this order. It proves that one account can be reached by both email and phone
using a single test number.

### 5.1 Link number B to the email account (SMS 1)

On phone B, sign in with the staging email account. Linking requires a sign-in within
the last 10 minutes.

1. Go to **Settings → add phone**. Enter number B, accept the consent, and request the code.
2. **Wrong code:** enter a wrong code once. It is refused, and the attempts left are shown.
3. **Resend too soon:** the resend button stays disabled and shows a countdown. The
   server cooldown is 60 seconds and returns `retryAfterSec`. No second SMS arrives.
4. Enter the real code. It arrives on phone B from phone A's number. The account now shows
   number B.

### 5.2 Sign in with number B (SMS 2)

1. Sign out.
2. Choose **Sign in with phone → Palestine → number B**, then enter the code.
3. Expected: the **same** account as 5.1, with the same chats and the real display name.
   No new account is created.

### 5.3 New-account sign-up (SMS 3, optional)

1. Sign out.
2. Choose phone sign-in with phone A's own number. The code arrives on phone A; type it
   on phone B.
3. Expected: a new account is created and asks for a name.

### 5.4 Emergency stop (no SMS)

1. Set `emergencyStop: true` and `policyVersion: previous + 1`.
2. Reopen the phone screen. It shows no countries.
3. A request from a screen that was already open fails with `service-paused`.
4. No new `relayJobs` document appears.

### After each step

In `relayJobs`, check the following:
- one new job per code requested;
- each job was claimed by the staging relay and by no other device;
- no job is left `queued` or `sending`;
- `relayDevices/<id>.usage` grows by one per SMS.

## 5b. Completion tests (gate before production SMS)

A first SMS arriving does not prove the safeguards. Run every row below on staging and
record the observed result in §7 before production sending is enabled
(`PRODUCTION_RELEASE.md` stage 7).

**Ground rules**
- Change one limit at a time, raise `policyVersion` by 1 with each edit, and restore the
  value from §1 afterwards.
- A limit of `0` closes that scope: every request is refused before any job exists
  (`functions/src/phoneLink/limits.ts:140-160`).
- Unless a row says otherwise, a refused request creates **no** `relayJobs` document and
  sends no SMS. Check `relayJobs` after each row.

| # | Setup | Action on phone B | Expected | SMS |
|---|---|---|---|---|
| T1 | — | Link number B to the email account (5.1) | number linked | 1 |
| T2 | — | Sign out, sign in with number B (5.2) | same UID, same chats, real name | 1 |
| T3 | `signin.limits.maxVerifyAttempts: 2` | Sign in with number B. Enter a wrong code twice, then the correct one | 1st: `code-invalid` with 1 attempt left. 2nd: `too-many-attempts`. The correct code is then refused too, because the code is burned | 1 |
| T4 | `signin.limits.codeTtlSec: 60` (the minimum) | Sign in with number B. Wait 70 s, then enter the correct code | `code-expired`; no sign-in | 1 |
| T5 | `link.limits.codeTtlSec: 60` | On an email account with no phone, request a link code for a second number you control, wait 70 s, enter it | `code-expired`; nothing linked. Skip this row if no second number | 1 |
| T6 | `signin.limits.destinationPerDay: 0` | Request a sign-in code for number B | `rate-limited`, scope `destination` | 0 |
| T7 | `signin.limits.globalPerHour: 0` | Request a sign-in code | `service-busy`, scope `global` | 0 |
| T8 | `shared.perHour: 0` | Request a sign-in code | refused, scope `global` (the shared budget reports `global`) | 0 |
| T9 | `link.limits.accountPerHour: 0` | Request a link code on an email account | refused, scope `account` | 0 |
| T10 | — | Request a code for a number that does not start with 59 or 56 | `number-not-supported` | 0 |
| T11 | relay `status: "paused"` | Reopen the phone screen; request a code | no countries offered, or `no-relay-for-country` | 0 |
| T12 | relay active, phone A in **airplane mode** | Request a sign-in code (the job stays `queued`). Set `emergencyStop: true`. Turn airplane mode off | `onOtpPolicyWritten` marks the job `failed` and removes its body. No SMS arrives after phone A reconnects | 0 |
| T13 | `emergencyStop: true` | Reopen the phone screen; request a code | no countries / `service-paused` (5.4) | 0 |

At most six SMS in total, within the `globalPerDay: 10` budget from §1.

## 6. Leave staging stopped

1. `smsConfig/otp`:
   - `emergencyStop: true`
   - `enabled: false`
   - `signin.enabled: false`
   - `link.enabled: false`
   - `policyVersion: previous + 1`
2. `relayDevices/<id>`: `status: "paused"`. If the relay is no longer needed, revoke it
   instead with the `revokeRelayDevice` callable, which also revokes its sign-in.
3. Optional: remove the two `PHONE_*` lines and redeploy. The stopped policy already
   blocks sending.

## 7. Results record

| Check | Expected | Observed | Time (UTC) |
|---|---|---|---|
| Relay certificate | `fac61745…3b9c` | | |
| Pairing, heartbeat, countries | active, 0.2.0, `["PS"]` | | |
| 5.1 wrong code | refused, attempts left shown | | |
| 5.1 resend too soon | disabled with a countdown, no SMS | | |
| 5.1 link | SMS received, number linked | | |
| 5.2 phone sign-in | same account and name | | |
| 5.3 sign-up (optional) | new account | | |
| 5.4 emergency stop | no countries / `service-paused`, no job | | |
| Final state | stopped, relay paused | | |
| SMS sent in total | ≤ 3 | | |
