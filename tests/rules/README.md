# Firestore Rules Tests

These tests verify `firestore.rules` end-to-end against the Firebase
Firestore emulator using `@firebase/rules-unit-testing`.

## Running

**Terminal A** — start the emulator (Java required):

```sh
firebase emulators:start --only firestore
```

**Terminal B** — run the suite:

```sh
npm run test:rules
```

## What's covered

| File | Collections | Acceptance focus |
|---|---|---|
| `users.rules.test.ts` | `users/{uid}` | profile read, allowed preference writes, role/admin field protection |
| `conversations.rules.test.ts` | `conversations/{id}` + sub-collections | participant gating, text-message validation, owner-only userState/typing |
| `sms.rules.test.ts` | `smsBatches/{id}` + `recipients` | sender read, client-write deny |
| `wallet.rules.test.ts` | `wallets`, `transactions`, `payments`, `pointsTransfers` | own-read, client-write deny, payment server-only |
| `support.rules.test.ts` | `tickets` | owner create with status=open, admin field protection, admin-only updates |
| `system.rules.test.ts` | `auditLogs`, `gatewayHealth`, `smsDeliveryEvents`, `smsQuotaUsage`, `transferQuotaUsage` | all client-write deny; admin-read where applicable |

## CI

These tests are NOT run in CI by default — the Firestore emulator
requires Java and adds significant boot time. Run them locally before
merging changes that touch `firestore.rules`. A future CI job can boot
the emulator in a Java-enabled image; tracked as a Phase 21 follow-up.

## Adding tests

Use the helpers from `tests/helpers/rules-helpers.ts`:

```ts
import { asUser, asAdmin, asAnon, clearAll, seed, teardownEnv } from '../helpers/rules-helpers';
import { assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
```

- `asUser(uid)` — authenticated context as the given uid (no admin claims)
- `asAdmin(uid?)` — authenticated context with `admin: true` claim
- `asAnon()` — unauthenticated context
- `seed(fn)` — runs `fn` with rules disabled to set up fixture docs
- `clearAll()` — wipes Firestore between tests
- `teardownEnv()` — disposes the test environment (call in `afterAll`)
