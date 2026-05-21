# @offlinesms/dashboard

Next.js 14 (App Router) admin dashboard.

```bash
npm install
cp .env.example .env.local  # add Firebase keys
npm run dev                  # http://localhost:3000
```

## Pages (heavy first cut)

| Route                  | Status |
|------------------------|--------|
| `/login`               | ✅ Email + Google sign-in |
| `/admin`               | ✅ Overview with stats and gateway health |
| `/admin/users`         | ✅ Live Firestore list |
| `/admin/chats`         | TODO |
| `/admin/groups`        | TODO |
| `/admin/calls`         | TODO |
| `/admin/sms`           | ✅ Gateway settings + policy panels |
| `/admin/points`        | ✅ Org wallet + packages + cost rules |
| `/admin/reports`       | TODO |
| `/admin/support`       | TODO |
| `/admin/roles`         | TODO |
| `/admin/settings`      | TODO |

## Middleware

For production, add `middleware.ts` to gate `/admin/*` behind a Firebase ID token
cookie verified by `firebase-admin`. Reference: https://firebase.google.com/docs/auth/admin/manage-cookies
