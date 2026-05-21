# OfflineSMS

Production scaffold for the OfflineSMS messaging platform.

> Messaging that just flows. When your in-app message doesn't land, OfflineSMS falls back to SMS — paid for with OfflineSMS Points.

## Monorepo layout

```
offlinesms/
├── apps/
│   ├── mobile/       Expo + React Native Web — iOS, Android, Web
│   └── dashboard/    Next.js 14 (App Router) + Tailwind — Admin web app
├── packages/
│   └── design-tokens/  Shared color/type/spacing tokens
├── functions/        Firebase Cloud Functions (SMS gateway mock, points, triggers)
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
├── scripts/seed.ts   Demo data seeder
└── docs/             Architecture, Firebase setup, data model
```

## Quick start

```bash
# 1. Install deps (npm workspaces)
npm install

# 2. Copy env templates
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
cp apps/dashboard/.env.example apps/dashboard/.env.local

# 3. Fill in Firebase config → see docs/FIREBASE_SETUP.md

# 4. Run dashboard
npm run dev:dashboard       # http://localhost:3000

# 5. Run mobile (web target)
npm run dev:mobile          # http://localhost:8081

# 6. Run functions emulator
npm run dev:functions

# 7. Seed demo data (after auth account exists)
npm run seed
```

## Docs
- [docs/FIREBASE_SETUP.md](./docs/FIREBASE_SETUP.md) — project creation, services, env keys
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — system topology
- [docs/DATA_MODEL.md](./docs/DATA_MODEL.md) — Firestore collections + types

## Status

This is a **heavy first cut** of the design. Major flows are scaffolded across
mobile + dashboard with real Firebase wiring; some sub-screens contain
`TODO` markers where the design is rich but logic is straightforward to fill in.
See per-app READMEs for a coverage matrix.

## License
Proprietary · © 2026 OfflineSMS
