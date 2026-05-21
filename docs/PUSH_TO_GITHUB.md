# Push to GitHub — `offlinesms` repo

The monorepo is in the `offlinesms/` folder of this project. To get it onto GitHub:

## 1. Download it
Use the "Download as zip" button I'll surface for the `offlinesms/` folder.

## 2. Unzip somewhere local
```bash
unzip offlinesms.zip
cd offlinesms
```

## 3. Create the GitHub repo + push (one-time)
You can do this two ways — either is fine.

### A) Via the GitHub CLI
```bash
gh repo create raedrasheed/offlinesms --private --source=. --remote=origin
git init -b main
git add .
git commit -m "feat: initial monorepo (mobile + dashboard + functions)"
git push -u origin main
```

### B) Via the web UI
1. https://github.com/new → name `offlinesms` → leave it empty.
2. Then locally:
```bash
git init -b main
git remote add origin https://github.com/raedrasheed/offlinesms.git
git add .
git commit -m "feat: initial monorepo"
git push -u origin main
```

## 4. Set GitHub Action secrets
In `Settings → Secrets and variables → Actions`, add:

| Secret name | Value |
|---|---|
| `NEXT_PUBLIC_FIREBASE_API_KEY`     | from Firebase web config |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `offlinesms-prod.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID`  | `offlinesms-prod` |
| `NEXT_PUBLIC_FIREBASE_APP_ID`      | from Firebase web config |

The first push will run CI: type-check + lint + build for dashboard, mobile (web), and functions.

## 5. Continue with Firebase
Follow `docs/FIREBASE_SETUP.md` to provision the project, deploy rules, and seed data.
