# App Store Review — fixed demo login

Current phone credentials: **+970599999999 / 123456**.

The server's v2 phone flow reserves this alias for a single, admin-bound demo
UID. It never resolves the alias to an ordinary phone owner, queues an SMS,
creates another account, or grants welcome points. The credential has no automatic
expiry. Individual sessions/challenges still expire; App Check, proof-of-work
and abuse limits remain enforced. Disabling the binding or the demo account
blocks new tokens, including retries.

## Restore the existing demo

Use an account authorized to deploy Firebase Functions and Admin SDK credentials
for the same project. Keep credential files outside the repository.

```powershell
# From the updated repository (Node.js 22):
npm ci
npx firebase deploy --project offlinesms-prod-2027 --only "functions:startPhoneAuth,functions:requestPhoneAuthCode,functions:verifyPhoneAuthCode,functions:getSupportedPhoneCountries"

# Set this to your existing service-account JSON; never upload/commit the key.
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secure\offlinesms-service-account.json"
node --import tsx scripts/restoreFixedReview.ts --project=offlinesms-prod-2027
```

The restore script finds the original phone demo created by `seedReviewDemo.ts`
and requires its exact historical demo markers, an active profile and no
privileged claims. It preserves the UID, conversations, contacts, wallet and
transactions, designates the account with only `demoReview: true`, removes the
unproved phone identity and enables `smsConfig/otp.signin.fixedReview`.
It does not turn on general SMS, change relay settings or create a substitute
account if the original is missing. Re-running it reuses the bound UID.

If an already-designated demo is used instead, pass `--uid=<demo uid>` explicitly.
A normal/admin account is rejected by the default restoration flow.

### Existing test account with its own profile and review data

If the operator has confirmed an existing account is their Apple review test
account, its display name, username and biography need not match the historical
seed. Explicitly designate its **known UID**, preserving those fields and all
existing content:

```powershell
node --import tsx scripts/restoreFixedReview.ts --project=offlinesms-prod-2027 --uid=<existing-test-account-uid> --designate-existing-demo
```

This option requires Admin SDK credentials, an explicit UID, an active account
with the exact fixed phone alias, no email/other sign-in providers or MFA, no
custom claims, and no privileged/organization profile fields. A conflicting
fixed-review UID is rejected. It designates only that account, then runs the
same restoration steps: no new user, no SMS, and no reset of profile text,
messages, contacts, wallet or transactions. Repeating it for the same account
after successful designation is supported even after its Auth phone is removed.
The number remains a fixed login alias; it is not recorded as verified phone
ownership. Do not apply this option to an ordinary user's account.

Only this local administrative script needs updating; the option does not
require a mobile rebuild or another Functions deployment once the fixed-login
functions above are deployed. Test a **fresh** login after successful setup.

Do not rerun the historical `seed:review`
script to activate this login: it predates the protected flow and may create a
different phone account. For a deliberate shutdown:

```powershell
node --import tsx scripts/restoreFixedReview.ts --project=offlinesms-prod-2027 --disable
```

## Verify the submitted build before resubmission

1. Sign out and open the actual iOS build sent to App Review.
2. Choose **Continue with phone → Palestine (+970)** and enter **599999999**.
3. Tap **Send code**, then enter **123456** manually. No SMS is sent.
4. Confirm the existing demo content appears. Sign out and repeat.
5. Update App Review Information with these exact credentials and instructions.

This server change supports builds using `startPhoneAuth`,
`requestPhoneAuthCode` and `verifyPhoneAuthCode` (the current mobile source).
Retired legacy OTP endpoints remain disabled; an older build using them needs
an app update. Repository/emulator checks do not establish production activation
or successful testing of Apple's submitted binary.

Suggested App Review login notes:

> Demo phone: +970599999999. Verification code: 123456.
> Choose Continue with phone, select Palestine (+970), enter 599999999,
> tap Send code, and enter 123456 manually. This is a designated demo account;
> no SMS is sent. The login credentials do not expire automatically.

## Archived notes for version 2.2.16 (build 8)

The material below describes an older release and its old seeding procedure.
Use the restoration procedure above for the current protected phone flow.

# App Store Review — OfflineSMS Messenger 2.2.16 (build 8)

Addresses the rejection of 2.2.15 (build 7):
- **3.1.1 (IAP):** Apple read the app as offering business/organization account
  registration (an external purchase/subscription mechanism).
- **2.1(a) (Information Needed):** Apple needs a working demo account with
  pre-populated content.

## What changed in the app
- **No business/organization registration exists in the mobile app.** The only
  account paths are normal end-user sign-in: **Continue with phone** (OTP) and
  **Use email** (email OTP), plus an email **password** sign-in. There is no
  account-type/business/organization selection, no "create organization", no
  links to a web dashboard signup, pricing, sales, plans, or subscriptions.
  (Verified by source search — see below.)
- **No selling of digital content.** No "Buy points", USD prices, packages,
  bonus wording, checkout, invoices, external/website/WhatsApp payment, or
  payment confirmation. The Points screen shows balance / available / reserved /
  transaction history only, plus an informational **Request points** screen:
  > "Points are assigned by the OfflineSMS admin. Purchasing points is not
  > available in the mobile app."
  Tapping a package sends an in-app request that an administrator reviews
  **outside** any purchase flow. Points are usage credits for sending SMS.
- **Review-safe login added:** a "Sign in with a password instead" link on the
  email screen so reviewers can log in with the demo email/password — no SMS and
  no relay coverage required.

## Demo account (App Review Information)

Seed it once against the production project:

```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
DEMO_REVIEW_EMAIL=appreview@offlinesms.com \
DEMO_REVIEW_PASSWORD='<choose-a-strong-password>' \
npm run seed:review
```

This creates a **non-expiring** email/password account pre-populated with:
- a profile (`@reviewer`, profile completed),
- two contacts searchable by username (`@lina`, `@samr`) so the reviewer can
  start a brand-new chat,
- one existing direct chat with sent **and** received sample messages,
- a points balance (2,500) and transaction history (admin grant + SMS spend).

Put these into App Store Connect → **App Review Information**:
- **Sign-in required:** Yes
- **Phone number (primary):** `+970599999999`
- **How to sign in (phone):** On the welcome screen tap **Continue with phone**,
  choose country **Palestine (+970)**, enter **599999999**, tap **Send code**,
  then enter verification code **123456**.
- **User name (email fallback):** `appreview@offlinesms.com`
- **Password (email fallback):** the value used for `DEMO_REVIEW_PASSWORD`
- **How to sign in (email):** Welcome → **Use email** → **"Sign in with a
  password instead"** → enter the demo email + password.

> The fixed test number `+970599999999` / code `123456` skips real SMS and its
> country is always selectable in the picker. This is **not** a general auth
> bypass — it is limited to that one number plus the seeded demo accounts.

## Verification performed
- `npx expo config` → version **2.2.16**, sdk **53.0.0**, bundle id
  **app.offlinesms.mobile**, build **8**, `ITSAppUsesNonExemptEncryption=false`.
- Source search: no business/organization **registration** UI, no external
  signup/dashboard/pricing links; no Buy/USD/checkout/purchase/package‑price UI.
- Mobile typecheck, i18n parity, and the full unit suite pass.

---

## Exact App Review Notes (paste into "Notes")

```
OfflineSMS Messenger is a consumer messaging app (1:1 and group chat, status,
calls).

ACCOUNT TYPES
- The app supports normal end-user accounts only. Sign in with phone (SMS code)
  or email. There is NO business or organization registration in the app, no
  account-type selection, and no links to any external signup, web dashboard,
  pricing, plans, sales, or subscription pages.

NO DIGITAL PURCHASES
- The app does not sell points, credits, subscriptions, or any digital content.
  There are no in-app purchases, prices, packages, checkout, invoices, or
  external payment links.
- "Points" are usage credits for sending SMS. They are assigned to a user by
  an OfflineSMS administrator OUTSIDE the app. The
  in-app "Request points" screen is informational only and states that
  purchasing points is not available in the mobile app.

DEMO ACCOUNT (sign-in required)
- Phone (primary): +970599999999, verification code 123456.
  To sign in: Welcome -> "Continue with phone" -> country Palestine (+970) ->
  enter 599999999 -> "Send code" -> enter 123456. This is a fixed test number
  that does not send a real SMS.
- Email (fallback): appreview@offlinesms.com / <the DEMO_REVIEW_PASSWORD value>.
  To sign in: Welcome -> "Use email" -> "Sign in with a password instead".
- Both accounts are pre-populated with an existing chat, contacts to start a new
  chat (search @lina or @samr), sent/received messages, and a points balance +
  history.

Thank you for re-reviewing.
```

## Exact Reply to App Review (paste into the Resolution Center reply)

```
Hello, and thank you for the review.

Guideline 3.1.1: We have confirmed and ensured the app contains no business or
organization account registration. The mobile app offers only normal end-user
sign-in (phone code or email). There is no account-type/business/organization
selection and no links to any external signup, web dashboard, pricing, plans,
sales, or subscription pages. The app does not sell points, credits,
subscriptions, or any digital content, and contains no in-app purchases,
prices, packages, checkout, invoices, or external payment links. "Points" are
usage credits for sending SMS that are assigned to a user by an OfflineSMS
administrator outside the app; the in-app "Request points"
screen is informational only.

Guideline 2.1(a): We provided a demo account with pre-populated test data in App
Review Information. Primary sign-in is a fixed test phone number that does not
send a real SMS: Welcome -> "Continue with phone" -> Palestine (+970) -> enter
599999999 -> "Send code" -> enter code 123456. An email/password fallback is
also provided (Welcome -> "Use email" -> "Sign in with a password instead"). The
account has an existing chat, contacts to start a new chat, sample sent/received
messages, and a points balance with history.

This is version 2.2.16 (build 8). We appreciate your time and are happy to
provide anything else you need.
```
