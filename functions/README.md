# @offlinesms/functions

Firebase Cloud Functions (gen 2).

## What's wired

| Function              | Trigger                                | What it does |
|-----------------------|----------------------------------------|--------------|
| `onMessageCreate`     | Firestore: messages/{msgId} create     | Updates conversation summary + fans out per-recipient receipt placeholders |
| `escalateSms`         | Callable                               | Reserves points → dispatches to OfflineSMS Gateway (mock) → records batch |
| `onSmsBatchAccepted`  | Firestore: smsBatches update           | Refund unused reservation, write transaction record |
| `buyPoints`           | Callable                               | Credits wallet for a known package (Stripe wiring is a TODO) |
| `transferPoints`      | Callable                               | Atomic peer-to-peer point transfer |
| `onUserCreate`        | beforeUserCreated identity trigger     | Initializes user doc + wallet with 50-pt welcome credit |
| `setAdminClaim`       | Callable (admin-only)                  | Sets the `admin: true` custom claim on a user |

## Local dev
```bash
npm install
npm run serve   # boots Firebase emulators (functions + firestore + auth)
```

## Mock SMS gateway
`src/sms/gateway.ts` simulates a 90/10 success/failure split with 400ms latency.
Swap `sendBatch` for a real implementation when you wire a provider — keep the
return shape (`gatewayBatchId`, `acceptedRecipientIds`, `rejectedRecipientIds`)
so the rest of the system keeps working.
