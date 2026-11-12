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


## Organization portal

OfflineSMS Business is served at `https://business.offlinesms.com` by the same Next.js service as the dashboard. The portal accepts existing organization administrator accounts and scopes each workspace to the organization on its session. API clients can continue to call `/api/v1/org/` routes on the dashboard hostname.

For a production rollout, add `business.offlinesms.com` as a custom domain on the existing DigitalOcean App Platform service under **Networking → Domains**. Select **You manage your domain**, create the CNAME shown by DigitalOcean with your DNS provider, and wait for TLS to become active. Keep the dashboard domain on the service. See [DigitalOcean's custom domain instructions](https://docs.digitalocean.com/products/app-platform/how-to/manage-domains/).

For local verification, start the dashboard and use the Business host header:

```sh
curl -i -H 'Host: business.offlinesms.com' http://localhost:3000/login
curl -i -H 'Host: business.offlinesms.com' http://localhost:3000/admin
curl -i -H 'Host: dash.offlinesms.com' http://localhost:3000/login
```

The first request shows the Business login, the second returns 404, and the third shows the Admin login. Test an existing organization administrator on the Business domain before communicating the new sign-in URL to institutions.
