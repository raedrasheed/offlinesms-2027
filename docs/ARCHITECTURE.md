# Architecture

```
                       ┌────────────────────┐
              ┌────────▶ Mobile (Expo)      │
              │        │  iOS · Android · Web │
              │        └──────────┬─────────┘
              │                   │
              │                   │ Firebase JS SDK
              │                   ▼
┌──────────────────────────────────────────────────────────┐
│                  Firebase services                       │
│  ┌────────────┐  ┌────────────┐  ┌──────────────┐        │
│  │   Auth     │  │ Firestore  │  │   Storage    │        │
│  └────────────┘  └─────┬──────┘  └──────────────┘        │
│                        │                                  │
│                  Firestore triggers                       │
│                        ▼                                  │
│            ┌─────────────────────────┐                    │
│            │  Cloud Functions (gen2) │                    │
│            │  • onMessageCreate      │                    │
│            │  • escalateSms          │──────▶ OfflineSMS  │
│            │  • onSmsBatchAccepted   │        Gateway     │
│            │  • buyPoints / transfer │        (mock)      │
│            │  • onUserCreate         │                    │
│            └─────────────────────────┘                    │
│                                                          │
│  ┌──────────────────────────────────────────────────┐    │
│  │             Cloud Messaging (push)               │    │
│  └──────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
              ▲                  ▲
              │                  │
              │                  │ firebase-admin (server)
              │        ┌─────────┴─────────┐
              └────────│ Dashboard (Next)  │
                       │  Server + Client  │
                       └───────────────────┘
```

## Key invariants

- **OfflineSMS owns the SMS layer.** No third-party provider name is exposed
  to users or admins. The Cloud Function `escalateSms` calls
  `sms/gateway.sendBatch()` which is currently a mock. Production wiring is
  isolated to one file.
- **Points are server-authoritative.** Wallets cannot be mutated from the
  client; everything flows through Cloud Functions (`buyPoints`,
  `transferPoints`, `escalateSms`, `onSmsBatchAccepted`).
- **Receipts are sub-collection per message.** `/conversations/{c}/messages/{m}/receipts/{uid}`
  holds delivered/read/played timestamps, populated by `onMessageCreate` and
  the mobile client.
- **Custom claims gate admin.** `request.auth.token.admin === true` is the
  single source of truth for elevated access (Firestore rules + dashboard).
