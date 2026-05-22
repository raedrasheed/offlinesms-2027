# Environment & Secrets Checklist

Complete this checklist before deploying to each environment.
**Never commit secret values to the repository.**

---

## Firebase Project

- [ ] Firebase project created and linked: `firebase use <project-id>`
- [ ] Firestore enabled (Native mode, region matches functions region)
- [ ] Firebase Authentication enabled with Phone provider
- [ ] Firebase Storage enabled (if media upload is ever added — scaffold only for now)
- [ ] Firebase App Check configured (Play Integrity on Android, DeviceCheck on iOS, reCAPTCHA on web)

---

## Cloud Functions Environment Variables

Set via `firebase functions:config:set` or Firebase Secret Manager (recommended for secrets).

### Required — SMS gateway

| Key | Description |
|---|---|
| `sms.provider_url` | Base URL for the SMS gateway REST API |
| `sms.api_key` | API key for the SMS gateway (use Secret Manager) |
| `sms.sender_id` | Alphanumeric sender ID shown to recipients |

> No provider name should appear in any UI copy or log entry visible to end users.

### Required — App

| Key | Description |
|---|---|
| `app.app_url` | Public URL of the dashboard (e.g., `https://admin.example.com`) |
| `app.support_email` | Support email address shown in error screens |
| `app.env` | `production` \| `staging` |

### Required — Points / payments (webhook verification only)

| Key | Description |
|---|---|
| `payments.webhook_secret` | HMAC secret for verifying incoming payment webhook signatures (Secret Manager) |

> No payment-provider SDK keys or UI. Only the webhook secret is used server-side.

### Optional — Notifications (scaffold only)

| Key | Description |
|---|---|
| `notifications.fcm_key` | Firebase Cloud Messaging server key — used only when notification-dispatch function is enabled |

---

## Mobile App Config (`.env` per flavor — never committed)

| Variable | Description |
|---|---|
| `FIREBASE_API_KEY` | Firebase web API key |
| `FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `FIREBASE_MESSAGING_SENDER_ID` | FCM sender ID |
| `FIREBASE_APP_ID` | Firebase app ID |

Mobile apps use `google-services.json` (Android) and `GoogleService-Info.plist` (iOS)
provided by the Firebase console. These files must **not** be committed.

---

## Dashboard App Config (Next.js `.env.local` — never committed)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Firebase auth domain |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Firebase storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | FCM sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Firebase app ID |
| `BOOTSTRAP_ADMIN_EMAILS` | Comma-separated list of email addresses granted temporary `bootstrap_admin` access to `/admin` before any real admin claims exist. Set to the first operator's email, then remove after the first `super_admin` is promoted. Example: `operator@example.com` |

---

## Verification Steps

- [ ] `firebase functions:config:get` shows all required keys (values redacted in this doc)
- [ ] No secret values appear in `firebase functions:config:get` output checked into version control
- [ ] `.gitignore` includes `.env`, `.env.local`, `google-services.json`, `GoogleService-Info.plist`
- [ ] Firestore Security Rules reference no hardcoded secrets
- [ ] App Check enforcement enabled on all Firebase services in the console
- [ ] SMS gateway account is funded and test message delivered successfully
- [ ] Payment webhook secret rotated from any staging value
- [ ] Firebase project has billing enabled (required for outbound HTTP in Cloud Functions)

---

## Staging vs Production Parity

Before promoting staging to production, verify:

- [ ] Both environments use the same Firestore rules version (same git commit)
- [ ] Both environments use the same Cloud Functions version
- [ ] Staging smoke tests completed with zero failures
- [ ] Staging audit log has entries from smoke-test actions
- [ ] SMS rate limits identical in both environments (`MAX_RECIPIENTS_PER_BATCH`, cool-down window)
- [ ] Points cost per SMS identical in both environments (`costPerSms`)
