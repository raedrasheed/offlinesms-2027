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
  > "Points are assigned by your organization or OfflineSMS admin. Purchasing
  > points is not available in the mobile app."
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
- **User name:** `appreview@offlinesms.com`
- **Password:** the value used for `DEMO_REVIEW_PASSWORD`
- **How to sign in:** On the welcome screen tap **Use email** → **"Sign in with
  a password instead"** → enter the demo email + password.

> Alternative fixed-OTP path (no email/password): phone **+970599999999**, code
> **123456** (a scoped App-review test number that skips real SMS). Use the
> email/password path as the primary method — it does not depend on country/relay
> availability. This is **not** a general auth bypass; it is limited to that one
> number and the seeded demo account.

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
  their organization or by an OfflineSMS administrator OUTSIDE the app. The
  in-app "Request points" screen is informational only and states that
  purchasing points is not available in the mobile app.

DEMO ACCOUNT (sign-in required)
- Username: appreview@offlinesms.com
- Password: <the DEMO_REVIEW_PASSWORD value>
- To sign in: Welcome screen → "Use email" → "Sign in with a password instead"
  → enter the email and password above.
- The account is pre-populated with an existing chat, contacts to start a new
  chat (search @lina or @samr), sent/received messages, and a points balance +
  history.
- The app normally uses an SMS/email code; the password path above lets you test
  without receiving a code.

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
usage credits for sending SMS that are assigned to a user by their organization
or an OfflineSMS administrator outside the app; the in-app "Request points"
screen is informational only.

Guideline 2.1(a): We added a demo account and pre-populated test data, provided
in App Review Information. Because the app normally uses a one-time code, we
included a password sign-in path so you can log in without receiving a code:
Welcome → "Use email" → "Sign in with a password instead", then use the demo
email and password. The account has an existing chat, contacts to start a new
chat, sample sent/received messages, and a points balance with history.

This is version 2.2.16 (build 8). We appreciate your time and are happy to
provide anything else you need.
```
