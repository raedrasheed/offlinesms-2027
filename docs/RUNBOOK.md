# RUNBOOK — Run & Deploy (dashboard, mobile app, relay app, functions)

How to run all four targets and deploy Firebase functions. All targets share one
Firebase project: **`offlinesms-prod-2027`** (see `.firebaserc`).

> ⚠️ The committed `.env.example` files still reference the *old* `offlinesms-prod`
> project. Use the **`offlinesms-prod-2027`** values from Firebase Console →
> Project Settings, and the Storage bucket suffix **`.firebasestorage.app`**.

Windows note: examples use bash syntax. In PowerShell, set env vars with
`$env:NAME=value` (not `export NAME=value`).

---

## 0. Prerequisites (once)
```bash
node -v            # 20.x or 22.x
npm i -g firebase-tools
firebase login
```
- **Android Studio** (relay app) and/or an **Expo / EAS** account (mobile app).
- A **service account JSON** (Firebase Console → Project Settings → Service accounts)
  for the server/admin pieces and scripts.

## 1. Clone + install
```bash
git clone <repo> && cd offlinesms-2027
git checkout claude/integration-relay-presence-media   # combined branch for local/device testing
npm install                                            # installs all workspaces
```

---

## 2. Environment files

**Root `/.env`** (seed / admin scripts):
```
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
FIREBASE_PROJECT_ID=offlinesms-prod-2027
```

**`apps/dashboard/.env.local`** (client `NEXT_PUBLIC_*` + server admin):
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=offlinesms-prod-2027.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=offlinesms-prod-2027
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=offlinesms-prod-2027.firebasestorage.app
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_ADMIN_PROJECT_ID=offlinesms-prod-2027
FIREBASE_ADMIN_CLIENT_EMAIL=<from service account>
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
BOOTSTRAP_ADMIN_EMAILS=you@example.com
```

**`apps/mobile/.env`** (Expo public config):
```
EXPO_PUBLIC_FIREBASE_API_KEY=...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=offlinesms-prod-2027.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=offlinesms-prod-2027
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=offlinesms-prod-2027.firebasestorage.app
EXPO_PUBLIC_FIREBASE_APP_ID=...
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
EXPO_PUBLIC_LOCAL_FIRST_CHAT_LIST=1
EXPO_PUBLIC_LOCAL_FIRST_CONVERSATION=1
```

**`apps/mobile-relay`** — no `.env`. Register an Android app with package
**`app.offlinesms.business`** in the Firebase project, download its
`google-services.json`, and place it at `apps/mobile-relay/app/google-services.json`.

---

## 3. Deploy Firebase Functions (+ rules)
From the repo root (or anywhere under it — the CLI finds `firebase.json`):
```bash
# Functions (SMS + relay callables + the relay-only relayReaper schedule)
firebase deploy --only functions

# Rules the relay/media features rely on
firebase deploy --only firestore:rules,storage:rules
```
The HTTP send path stays the default — nothing changes until an org is switched
to relay/hybrid from the dashboard.

**If you hit `Cannot determine backend specification. Timeout after 10000`:**
the code is fine — Firebase's source-analysis step is just timing out on a cold
load. Raise the timeout and retry (it's often transient):
```bash
# bash
export FUNCTIONS_DISCOVERY_TIMEOUT=120 && firebase deploy --only functions
# PowerShell
$env:FUNCTIONS_DISCOVERY_TIMEOUT=120 ; firebase deploy --only functions
```
Sanity check before deploying: `cd functions && npm run build`.

Expected deployed functions include: `createRelayPairingCode`,
`enrollRelayDevice`, `claimRelayJobs`, `reportRelayDelivery`, `relayHeartbeat`,
`revokeRelayDevice`, and `relayReaper`.

> The "Node.js 20 deprecated" and "outdated firebase-functions" lines are
> warnings, not errors.

---

## 4. Run the Dashboard (Next.js)
```bash
npm run dev:dashboard          # http://localhost:3000  (or: cd apps/dashboard && npm run dev)
```
Production-style:
```bash
cd apps/dashboard && npm run build && npm start
```
Sign in with an email in `BOOTSTRAP_ADMIN_EMAILS` (or an admin-role user). Relay
admin lives at **`/admin/relay`**.

---

## 5. Run the OfflineSMS app (mobile · Expo)
```bash
cd apps/mobile
npx expo start            # dev server: press a (Android) / i (iOS) / w (web)
# or a native dev build (needs Android SDK / Xcode):
npm run android           # expo run:android
npm run ios               # expo run:ios
```
Cloud build (no local SDK):
```bash
npm run build:preview     # EAS build, internal distribution
```
> Phone sign-in is stubbed in this build — use **email login** unless phone OTP
> is wired.

---

## 6. Run OfflineSMS-Business (Android relay)
Native Kotlin (not an npm package). Requires `google-services.json` (§2) and the
**functions deployed** (§3).
```bash
cd apps/mobile-relay
gradle wrapper                 # first time only
./gradlew :app:assembleDebug   # build the APK
# install on a phone WITH A SIM, then grant SMS + notification permissions
```
Then:
1. In the dashboard `/admin/relay`, set the org mode (Relay/Hybrid) and
   **Create pairing code**.
2. Open the relay app → enter the code → it enrolls and shows **Online**.

Full runbook + manual reliability checklist: `apps/mobile-relay/README.md`.

---

## 7. Optional — local emulators + seed
```bash
npm run firebase:emulators                 # all emulators
npm run seed                               # demo users/chats (root .env service account)
# mint a relay pairing code without the dashboard:
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json BUSINESS_ID=<orgId> npx tsx scripts/relayPairingCode.ts
```

## 8. Verify before deploying (optional)
```bash
cd functions && npm run build
cd apps/dashboard && npm run typecheck && npm run lint
cd apps/mobile && npx tsc --noEmit
npm test                                   # repo root: functions + dashboard unit tests
firebase emulators:start --only firestore  # terminal A, then in terminal B:
npm run test:rules
```

---

## First-time order that works
1. Firebase Console: enable Auth, Firestore, **Storage**; register the
   **`app.offlinesms.business`** Android app.
2. Fill the four env locations (§2).
3. **Deploy functions + rules** (§3).
4. Run the dashboard (§4) → enroll/manage relay devices.
5. Build/run the mobile app (§5) and the relay app (§6).
