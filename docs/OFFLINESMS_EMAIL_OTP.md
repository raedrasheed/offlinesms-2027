# OfflineSMS — Email OTP Sign-In

Passwordless email sign-in: the user enters an email, receives a 6-digit one-time
code, enters it, and is signed in (account auto-created on first use). Mirrors the
existing phone OTP flow (backend-issued code → Firebase **custom token** →
`signInWithCustomToken`). It does **not** replace the existing phone or
email/password flows.

## How it works

1. **`requestEmailOtp({ email })`** (callable, unauth)
   - Normalizes/validates the email.
   - Requires the admin **Email sign-in** flag (`systemSettings/general.emailSignInEnabled`); otherwise returns `email-signin-disabled`.
   - Enforces rate limits, generates a 6-digit code, stores **only a salted SHA-256 hash** in `emailOtpChallenges/{emailKey}` (the doc id is `sha256(email)`), and emails the code. Overwriting the doc **invalidates any previous active code**.
2. **`verifyEmailOtp({ email, code })`** (callable, unauth)
   - Transactionally checks: exists, not expired, attempts `< 5`, timing-safe hash match.
   - On success: consumes the code (single-use), finds-or-creates the user (`emailVerified = true`), returns a **custom token**.
   - On failure: increments `failedAttempts`, returns a generic error (no account enumeration).

The mobile app exposes `requestEmailOtp` / `verifyEmailOtpAndSignIn` / `resendEmailOtp`
in `apps/mobile/src/lib/auth.ts`, with screens `EmailEntry` → `EmailOtp`.

## Configuration (parameters)

| Parameter | Value | Where |
| --- | --- | --- |
| OTP length | 6 digits | `otpLogic.OTP_CODE_LENGTH` |
| OTP TTL | **10 minutes** | `emailOtpLogic.EMAIL_OTP_TTL_MS` |
| Max verify attempts | **5** per code | `otpLogic.OTP_MAX_ATTEMPTS` |
| Resend cooldown | **60 seconds** | `otpLogic.OTP_RESEND_COOLDOWN_MS` |
| Send rate limit | **5 per email / rolling hour** | `otpLogic.OTP_MAX_PER_HOUR` |
| Storage | salted SHA-256 hash, single-use | `emailOtpChallenges/{sha256(email)}` |

## Environment variables (Cloud Functions)

Set via Functions env / Secret Manager (never commit real values):

| Var | Required | Notes |
| --- | --- | --- |
| `EMAIL_PROVIDER` | no | `resend` (default) or `console` (local/dev, no real send). |
| `RESEND_API_KEY` | yes (resend) | Resend API key — https://resend.com → API Keys. |
| `EMAIL_FROM` | yes (resend) | Verified sender, e.g. `OfflineSMS <noreply@yourdomain.com>`. |

The support address shown in the email is read from `systemSettings/general.supportEmail` (optional).

## Email provider

Delivery goes through a small abstraction (`functions/src/lib/email/`):
- `providers/resend.ts` — Resend HTTP API via global `fetch` (no SDK dependency).
- `providers/console.ts` — local/dev; logs only that a message *would* be sent (recipient redacted, **body/code never logged**).

To add another provider (SendGrid, Mailgun, SMTP/Nodemailer), implement the
`EmailProvider` contract and register it in `functions/src/lib/email/index.ts`.

## Enabling the feature

Email sign-in is **off by default**. Turn it on in the dashboard:
**Admin → Settings → Feature flags → Email sign-in**, then Save.

## Security properties

- OTP codes are **never** stored in plaintext, returned in API responses, logged, or readable by clients.
- `emailOtpChallenges/*` is **backend-only** (`firestore.rules`: admin only).
- Audit log records `auth.email-otp.requested` / `auth.email-otp.verified` with the email/code redacted.
- Generic responses avoid revealing whether an account exists.

## Testing locally

- **Unit:** `npm run test` — see `functions/__tests__/emailOtpLogic.test.ts` (normalization, hashing/no-plaintext, expiry, attempts, cooldown, rate limit, key).
- **Rules:** `npm run test:rules` (requires `firebase emulators:start --only firestore`) — see `tests/rules/emailOtp.rules.test.ts` (clients denied, admin allowed).
- **End-to-end against the emulator:** set `EMAIL_PROVIDER=console` so no real email is sent, then read the issued code from the `emailOtpChallenges/{sha256(email)}` doc to complete `verifyEmailOtp`.
