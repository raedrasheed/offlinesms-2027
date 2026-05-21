# Firebase setup

## 1. Create the project
1. Visit https://console.firebase.google.com → **Add project** → name it `offlinesms-prod` (or your own slug).
2. Disable Google Analytics (or enable — your call).

## 2. Enable services

| Service | Where | Why |
|---|---|---|
| Authentication | Build → Authentication → Get started | Phone OTP + Email/Google |
| Firestore     | Build → Firestore → Create database (Native mode, your nearest region) | Primary data store |
| Storage       | Build → Storage → Get started | Media uploads |
| Cloud Messaging | Build → Cloud Messaging | Push notifications |
| Cloud Functions | Build → Functions → Upgrade to Blaze plan | Required for callable + triggers |

### Auth providers
Enable: **Phone**, **Email/Password**, **Google**.
For phone testing, add Test numbers in Settings → Phone numbers for testing.

## 3. Web + iOS + Android apps

1. **Web app** (used by mobile RN-Web build + dashboard).
   - Add Web app, copy the config object.
   - Fill in both `apps/mobile/.env` and `apps/dashboard/.env.local` using the
     keys from `.env.example`.

2. **iOS / Android apps** (mobile native).
   - Add iOS bundle ID `app.offlinesms.mobile` and Android package `app.offlinesms.mobile`.
   - Download `GoogleService-Info.plist` → `apps/mobile/ios/` and `google-services.json` → `apps/mobile/android/app/`.
   - For phone auth on native, install `@react-native-firebase/auth` and follow its setup. (See note in `apps/mobile/src/lib/auth.ts`.)

## 4. Service account (server)

Settings → Service accounts → **Generate new private key**. Save as `service-account.json` at the repo root.

Three env vars derive from it for the dashboard:
```env
FIREBASE_ADMIN_PROJECT_ID=offlinesms-prod
FIREBASE_ADMIN_CLIENT_EMAIL=…@offlinesms-prod.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMI…==\n-----END PRIVATE KEY-----\n"
```

## 5. Deploy Firestore rules + indexes
```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage:rules
```

## 6. Deploy Cloud Functions
```bash
npm --workspace functions run build
firebase deploy --only functions
```

## 7. Seed demo data
```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npm run seed
```

## 8. Promote yourself to admin
After signing in once, find your `uid` in Authentication → Users, then call:
```js
// In an emulator shell or one-off node script:
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.applicationDefault() });
admin.auth().setCustomUserClaims('YOUR_UID', { admin: true });
```
You may need to sign out + back in for the new claim to take effect.

## Local emulators
```bash
firebase emulators:start
```
Set `EXPO_PUBLIC_USE_EMULATORS=1` in `apps/mobile/.env` to point the mobile app at the local Firestore emulator.
